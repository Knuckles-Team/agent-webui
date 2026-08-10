#!/usr/bin/env bash
# docker/deploy.sh -- THE single command for a local agent-webui release.
#
# Build -> verify -> push (by digest) -> deploy -> verify the rollout -> rebuild
# the live-mounted frontend bundle -> verify it's actually served. One command,
# every step it needs, in the order that avoids the three stale-code outcomes a
# 2026-08-07 incident hit in one day (see README.md "Build & Deploy" for the full
# writeup; short version below). Do not hand-roll any subset of this by hand --
# every step here exists because skipping it, once, shipped stale code to
# production.
#
#   1. digest-pinned image + `imagePullPolicy: Always` means a bare `kubectl
#      rollout restart` re-pulls the SAME bits forever -- deploying requires
#      `kubectl set image ... image@sha256:<new>` with an ACTUALLY NEW digest.
#      This script always deploys by digest, never by a mutable tag.
#   2. `uv pip install agent-utilities[...]` can silently resolve from stale
#      PyPI instead of the local wheel this build just produced (D-W5WR-1) --
#      the Dockerfile pins the exact local wheel FILE now, not a bare name; this
#      script never bypasses that.
#   3. The served frontend `dist/` can be stale independently of the backend:
#      apps/agent-webui's Deployment NFS-mounts this repo's `agent/` directory
#      at /webui-src ahead of site-packages (PYTHONPATH=/webui-src:/deps) so
#      backend .py edits go live on a pod restart with no image rebuild -- but
#      that mount ALSO shadows `Path(__file__).parent / 'dist'`, so the SERVED
#      frontend bundle is whichever `pnpm build` last ran on the CANONICAL
#      checkout's disk, independent of which Docker image is deployed. Rolling
#      the Deployment alone is NOT sufficient to ship a frontend change. This
#      script rebuilds `dist/` on the canonical checkout too, and verifies the
#      LIVE pod is serving it (via `kubectl exec`, not an assumption).
#
# Usage:
#   docker/deploy.sh                 # build, verify, push, deploy, verify -- everything
#   docker/deploy.sh --build-only    # stop after the local build+verify (no push, no deploy)
#   docker/deploy.sh --skip-deploy   # build, verify, push -- stop before touching the cluster
#                                     # (use this while another lane is actively deploying;
#                                     # see README.md "Coordinating concurrent deploys")
#
# Env overrides: see docker/build_and_push.sh for AU_SRC_PATH / IMAGE /
# DOCKER_CONTEXT. Additional ones for this script:
#   NAMESPACE           k8s namespace (default: apps)
#   DEPLOYMENT          k8s Deployment name (default: agent-webui)
#   CANONICAL_CHECKOUT  path to the agent-webui checkout that is NFS-exported to
#                        the live pod at /webui-src (default:
#                        /home/apps/workspace/agent-packages/agent-webui --
#                        the canonical checkout path this manifest's NFS export
#                        is hardcoded to; see inventory/k8s-migration/cutover/
#                        apptier/agent-webui.yaml). This is deliberately NOT
#                        derived from where this script itself lives, because a
#                        worktree checkout is not what's NFS-exported.
#   ROLLOUT_TIMEOUT      seconds to wait for the rollout (default: 300; must
#                        exceed minReadySeconds, see below)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NAMESPACE="${NAMESPACE:-apps}"
DEPLOYMENT="${DEPLOYMENT:-agent-webui}"
IMAGE="${IMAGE:-knucklessg1/agent-webui}"
CANONICAL_CHECKOUT="${CANONICAL_CHECKOUT:-/home/apps/workspace/agent-packages/agent-webui}"
ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-300}"

MODE=full
while [ $# -gt 0 ]; do
  case "$1" in
    --build-only) MODE=build-only; shift ;;
    --skip-deploy) MODE=skip-deploy; shift ;;
    *) echo "unknown argument: $1" >&2; exit 64 ;;
  esac
done

log() { echo "[deploy.sh] $*" >&2; }

# ── Step 0: print the rollback anchor FIRST, before anything else runs ──────────
# If the cluster is unreachable, better to find out now than after a push.
if command -v kubectl >/dev/null 2>&1 && kubectl -n "${NAMESPACE}" get deploy "${DEPLOYMENT}" >/dev/null 2>&1; then
  ROLLBACK_ANCHOR="$(kubectl -n "${NAMESPACE}" get deploy "${DEPLOYMENT}" \
    -o jsonpath='{.spec.template.spec.containers[0].image}')"
  log "ROLLBACK ANCHOR (current live image, record this BEFORE deploying):"
  log "  ${ROLLBACK_ANCHOR}"
  log "  rollback command if this release goes bad:"
  log "  kubectl -n ${NAMESPACE} set image deploy/${DEPLOYMENT} ${DEPLOYMENT}=${ROLLBACK_ANCHOR}"
else
  ROLLBACK_ANCHOR=""
  log "WARNING: cannot read the live Deployment (kubectl missing or cluster" \
      "unreachable) -- no rollback anchor captured. Proceeding with build only;" \
      "deploy steps will fail loudly if the cluster stays unreachable."
fi

# ── Step 1: build + verify (always; this is what build_and_push.sh does) ────────
log "Building image..."
if [ "${MODE}" = build-only ]; then
  "${REPO_ROOT}/docker/build_and_push.sh"
  log "MODE=build-only: stopping after local build+verify (not pushed, not deployed)."
  exit 0
fi

BUILD_OUT="$("${REPO_ROOT}/docker/build_and_push.sh" --push)"
echo "${BUILD_OUT}" | grep -v '^PUSHED_DIGEST=\|^BUILD_SHA=\|^BUILD_TIME=' >&2 || true
PUSHED_DIGEST="$(grep '^PUSHED_DIGEST=' <<<"${BUILD_OUT}" | cut -d= -f2-)"
BUILD_SHA="$(grep '^BUILD_SHA=' <<<"${BUILD_OUT}" | cut -d= -f2-)"
BUILD_TIME="$(grep '^BUILD_TIME=' <<<"${BUILD_OUT}" | cut -d= -f2-)"
if [ -z "${PUSHED_DIGEST}" ]; then
  log "FAILED: build_and_push.sh --push did not report a PUSHED_DIGEST. Aborting."
  exit 71
fi
log "Pushed digest: ${PUSHED_DIGEST}"

if [ "${MODE}" = skip-deploy ]; then
  log "MODE=skip-deploy: image built, verified, and pushed. NOT touching the" \
      "live cluster (another lane may be deploying -- see README.md" \
      "'Coordinating concurrent deploys')."
  log "To deploy this exact image later:"
  log "  kubectl -n ${NAMESPACE} set image deploy/${DEPLOYMENT} ${DEPLOYMENT}=${PUSHED_DIGEST}"
  exit 0
fi

if [ -z "${ROLLBACK_ANCHOR}" ]; then
  log "FAILED: refusing to deploy -- no rollback anchor was captured in Step 0" \
      "(cluster was unreachable). Fix cluster access and retry."
  exit 72
fi

# ── Step 2: ensure the 60s availability soak is a property of the Deployment ────
# minReadySeconds=60 makes Kubernetes itself hold the OLD pod up until the NEW
# pod has been continuously Ready for 60s -- the rolling-update controller will
# not scale the old ReplicaSet down until the new one counts as "Available"
# (Ready AND minReadySeconds elapsed). This is what "confirm ready=true/
# restarts=0 for ~60s before the old pod terminates" actually means at the k8s
# level, and setting it on the Deployment (not just checking it in this script)
# means EVERY future rollout gets the same guarantee, not just this one.
CURRENT_MRS="$(kubectl -n "${NAMESPACE}" get deploy "${DEPLOYMENT}" -o jsonpath='{.spec.minReadySeconds}')"
if [ "${CURRENT_MRS:-0}" != "60" ]; then
  log "Patching minReadySeconds=60 onto deploy/${DEPLOYMENT} (was '${CURRENT_MRS:-0}')..."
  kubectl -n "${NAMESPACE}" patch deploy "${DEPLOYMENT}" --type merge \
    -p '{"spec":{"minReadySeconds":60}}' >&2
fi

# ── Step 3: deploy by digest, wait for the rollout ───────────────────────────────
log "Deploying ${IMAGE}@${PUSHED_DIGEST#*@} ..."
NEW_IMAGE_REF="${IMAGE}@${PUSHED_DIGEST#*@}"
kubectl -n "${NAMESPACE}" set image "deploy/${DEPLOYMENT}" "${DEPLOYMENT}=${NEW_IMAGE_REF}" >&2
log "Waiting for rollout (timeout ${ROLLOUT_TIMEOUT}s; includes the 60s availability soak)..."
if ! kubectl -n "${NAMESPACE}" rollout status "deploy/${DEPLOYMENT}" --timeout="${ROLLOUT_TIMEOUT}s" >&2; then
  log "FAILED: rollout did not complete within ${ROLLOUT_TIMEOUT}s."
  log "ROLLBACK: kubectl -n ${NAMESPACE} set image deploy/${DEPLOYMENT} ${DEPLOYMENT}=${ROLLBACK_ANCHOR}"
  exit 73
fi

# ── Step 4: verify the running pod actually holds the new digest ────────────────
POD_NAME="$(kubectl -n "${NAMESPACE}" get pods -l app="${DEPLOYMENT}" \
  -o jsonpath='{.items[0].metadata.name}')"
POD_IMAGE_ID="$(kubectl -n "${NAMESPACE}" get pod "${POD_NAME}" \
  -o jsonpath='{.status.containerStatuses[0].imageID}')"
POD_READY="$(kubectl -n "${NAMESPACE}" get pod "${POD_NAME}" \
  -o jsonpath='{.status.containerStatuses[0].ready}')"
POD_RESTARTS="$(kubectl -n "${NAMESPACE}" get pod "${POD_NAME}" \
  -o jsonpath='{.status.containerStatuses[0].restartCount}')"
log "New pod: ${POD_NAME}  imageID=${POD_IMAGE_ID}  ready=${POD_READY}  restarts=${POD_RESTARTS}"
if [[ "${POD_IMAGE_ID}" != *"${PUSHED_DIGEST#*@}"* ]]; then
  log "FAILED: running pod's imageID does not match the digest just pushed."
  log "  expected: ${PUSHED_DIGEST#*@}"
  log "  actual:   ${POD_IMAGE_ID}"
  log "ROLLBACK: kubectl -n ${NAMESPACE} set image deploy/${DEPLOYMENT} ${DEPLOYMENT}=${ROLLBACK_ANCHOR}"
  exit 74
fi
if [ "${POD_READY}" != "true" ] || [ "${POD_RESTARTS}" != "0" ]; then
  log "FAILED: new pod is not stable (ready=${POD_READY} restarts=${POD_RESTARTS})."
  log "ROLLBACK: kubectl -n ${NAMESPACE} set image deploy/${DEPLOYMENT} ${DEPLOYMENT}=${ROLLBACK_ANCHOR}"
  exit 75
fi
log "OK: new pod holds the pushed digest, ready=true, restarts=0."

# Evidence the 60s soak actually happened: show the Scaled up/down events with
# their timestamps so the gap is auditable after the fact, not just asserted.
log "Rollout events (proves the availability soak, not just the final state):"
kubectl -n "${NAMESPACE}" get events --field-selector involvedObject.name="${DEPLOYMENT}" \
  --sort-by='.lastTimestamp' -o custom-columns=TIME:.lastTimestamp,REASON:.reason,MESSAGE:.message 2>&1 \
  | tail -10 | sed 's/^/  /' >&2

# ── Step 5: rebuild the LIVE-MOUNTED frontend bundle (trap #3) ──────────────────
# The image rollout above proves the DEPENDENCY closure changed (D-W5WR-1/2's
# concern). It does NOT prove the frontend changed: agent_webui's own package,
# dist/ included, is shadowed by the NFS mount at /webui-src for the life of the
# pod (see header). Rebuild it on the canonical checkout -- the one path that is
# actually NFS-exported to the pod -- with the SAME build-info.txt marker the
# image just carried, so both halves of the release agree on one sha/timestamp.
if [ ! -d "${CANONICAL_CHECKOUT}" ]; then
  log "FAILED: CANONICAL_CHECKOUT does not exist: ${CANONICAL_CHECKOUT}"
  log "The image rollout above succeeded, but the frontend bundle was NOT" \
      "rebuilt -- the live pod is still serving whatever dist/ it had before." \
      "Set CANONICAL_CHECKOUT and re-run, or finish this step manually."
  exit 76
fi
log "Rebuilding frontend dist/ on the canonical checkout (${CANONICAL_CHECKOUT})..."
(
  cd "${CANONICAL_CHECKOUT}"
  pnpm install --frozen-lockfile
  pnpm build
  printf 'sha=%s\nbuilt_at=%s\n' "${BUILD_SHA}" "${BUILD_TIME}" \
    > agent/agent_webui/dist/build-info.txt
) >&2

# ── Step 6: verify the LIVE pod is actually serving it (not an assumption) ──────
log "Verifying the live pod serves today's build-info.txt (via kubectl exec, not HTTP -- /build-info.txt requires an authenticated session like every other non-health route)..."
LIVE_BUILD_INFO="$(kubectl -n "${NAMESPACE}" exec "deploy/${DEPLOYMENT}" -- python3 -c \
  'import agent_webui, os
p = os.path.join(os.path.dirname(agent_webui.__file__), "dist", "build-info.txt")
print(open(p).read())')"
echo "${LIVE_BUILD_INFO}" | sed 's/^/  /' >&2
if ! grep -q "sha=${BUILD_SHA}$" <<<"${LIVE_BUILD_INFO}"; then
  log "FAILED: the LIVE pod is not serving sha=${BUILD_SHA} -- the frontend" \
      "rebuild in Step 5 did not reach the running pod. Check the NFS mount."
  exit 77
fi
log "OK: live pod confirmed serving sha=${BUILD_SHA}."

# Light HTTP sanity check too (/health is exempt from the auth gate).
if curl -fsS -m 10 -o /dev/null -w '%{http_code}' http://au.arpa/health 2>/dev/null | grep -q '^200$'; then
  log "OK: http://au.arpa/health -> 200."
else
  log "WARNING: http://au.arpa/health did not return 200 -- check DNS/ingress" \
      "reachability from this host; the kubectl-exec check above is the" \
      "authoritative signal, this is best-effort."
fi

log "RELEASE COMPLETE."
log "  new digest:      ${PUSHED_DIGEST}"
log "  frontend sha:     ${BUILD_SHA} (built_at=${BUILD_TIME})"
log "  rollback anchor:  ${ROLLBACK_ANCHOR}"
log "  rollback command: kubectl -n ${NAMESPACE} set image deploy/${DEPLOYMENT} ${DEPLOYMENT}=${ROLLBACK_ANCHOR}"
log "  (frontend rollback: re-run 'pnpm build' on ${CANONICAL_CHECKOUT} at the" \
    "previous commit if the new frontend is also bad -- the image rollback above" \
    "does not by itself revert dist/, per trap #3.)"
