#!/usr/bin/env bash
# Build (and optionally push) the agent-webui runtime image (D-WUI-30). Wraps the
# exact build invocation documented in the Dockerfile header so cutting an image
# is one command, not the multi-step manual process used to reconstruct this
# pipeline in the first place.
#
# THIS SCRIPT IS NOT THE OPERATOR ENTRYPOINT. It builds (and, with --push,
# publishes) the image; it never touches the live cluster. For a full local
# release -- build, verify, push, deploy, verify the rollout -- run
# `docker/deploy.sh` instead, which calls this script internally. Kept as a
# separate file (single responsibility: build/push only) so it can also be
# invoked standalone for a build-only smoke test.
#
# ── Pluggable build backend (2026-08-17) ─────────────────────────────────────
# r820 was the only host in this cluster with a working `docker build` daemon (a
# leftover from the pre-cutover Swarm era). It was deliberately stopped when
# docker was sunset in the Swarm->RKE2 migration (2026-07-11), so this script
# started failing outright with "cannot reach the docker daemon via context
# 'r820'". The fix is NOT to start dockerd back up on r820 -- it is the sole
# k8s control-plane node, cannot be safely rebooted (halts at POST awaiting a
# keypress, and its iDRAC password lives in the OpenBao it would take down),
# and a docker daemon rewrites iptables in ways that can disrupt cilium on a
# live cluster.
#
# This script supports TWO build backends behind one seam (`select_backend`
# below), not a replacement of one with the other -- some dev hosts genuinely
# have a working docker daemon (a laptop, a host that still runs one locally)
# and should keep using it; hosts that don't (most of this workspace, post
# cutover) use the cluster-native path instead. Detection is auto by default,
# in this DETERMINISTIC order (see select_backend/probe_docker/probe_buildkit):
#   1. BUILD_BACKEND=docker|buildkit (env var or --backend flag) forces that
#      backend outright -- probed once, fails loudly if unavailable, never
#      silently falls through to the other.
#   2. auto (default): probe docker first (local default daemon, then the
#      DOCKER_CONTEXT fallback, default 'r820') -- a directly reachable daemon
#      is simpler and faster when one genuinely exists. If docker is
#      unreachable on both, probe the shared cluster-native buildkitd
#      Deployment (services/buildkit-service/, spread across r510+r710 --
#      see that manifest's header for why r820/gb10/rw710 are excluded).
#   3. If NEITHER is reachable, fail with both specific reasons -- never guess,
#      never silently build somewhere unexpected.
# Whichever backend is chosen (forced or auto-detected) is printed to stderr
# before any build step runs, so "why did this ship stale bits" never has to
# be reconstructed after the fact.
#
# Both backends feed the IDENTICAL Dockerfile the identical three named build
# contexts (`context`, `au-src`, `eg-wheelhouse`) and build-args, so trap (b)
# (pin the exact locally-built agent-utilities wheel FILE, never a bare
# `agent-utilities[...]` name -- D-W5WR-1) is enforced by the Dockerfile
# itself, identically, regardless of backend. The build-info.txt verification
# (the check that closes trap/incident #3 -- "shipped stale/wrong frontend
# code") is likewise ONE shared function, `assert_build_info`, that both
# backends' captured output is checked against -- see WHY BUILD-INFO.TXT below
# for why *how* that text is obtained still differs by backend.
#
# WHY THE EXTRA BUILD CONTEXT (au-src): agent-webui's runtime imports
# agent_utilities.security.persistence_privacy and friends at module load,
# but PyPI's newest agent-utilities (1.26.4) doesn't have that module -- see
# the Dockerfile header for the full empirical trail. So the build needs
# agent-utilities' actual source tree (built into a wheel in-image, no Rust
# required). NEVER "simplify" this to `pip install agent-utilities[...]` --
# that silently resolves from stale PyPI (D-W5WR-1) and crash-loops
# production on a missing module.
#
# WHY build-info.txt, AND WHY THE CHECK'S MECHANICS DIFFER BY BACKEND: baked
# into the served SPA bundle at BUILD_SHA/BUILT_AT (see Dockerfile's
# frontend-build stage) -- this is what actually catches "the build succeeded
# but shipped stale/wrong frontend code," the exact class of bug that made
# D-WUI-30 necessary in the first place. Under docker, the image lands in a
# LOCAL daemon store, so it's verified by `docker run --rm` BEFORE anything is
# pushed anywhere (`docker_get_build_info`). BuildKit's client/server model has
# no such local store: buildctl's only way to materialize a built image for
# inspection is an exporter, and the only one a throwaway pod can run is
# `type=image,push=true` -- i.e. the image must already be IN the registry to
# be inspected (`buildkit_get_build_info`). So under BuildKit the check runs
# immediately AFTER push, BEFORE `docker/deploy.sh` ever calls `kubectl set
# image` -- the same gate (`assert_build_info`), resequenced, still fully
# blocking the one thing that matters (nothing gets deployed that doesn't
# carry today's build-info.txt). `--build-only` mode under BuildKit still
# needs an exporter target to verify against, so it pushes to a throwaway
# `:buildcheck-<sha>` tag instead of `:latest`/`:TAG` -- never the tags a real
# release or `docker/deploy.sh` would deploy by digest. Under docker,
# `--build-only` verifies the local tag directly and never pushes at all.
#
# ── TEMPORARY (2026-08-17): epistemic-graph PyPI wheelhouse ── BUG-258/
# BUG-262 added the `graphos` extra, which requires
# `epistemic-graph[full]>=2.23.2,<3.0.0` (agent-utilities' own pyproject.toml
# comment on that floor). Verified empirically: PyPI's newest published
# epistemic-graph is still 2.23.0 -- the floor is UNSATISFIABLE from the index
# alone. epistemic-graph's own repo has released source up to 2.26.1 (tagged,
# changelogged) but its PyPI publish pipeline hasn't kept pace -- a gap in
# THAT project, not this one. Rather than block BUG-258/BUG-262 on an
# unrelated repo's publish backlog, EG_WHEELHOUSE_PATH (required, see below)
# supplies a pre-built wheel out of band via a THIRD named build context,
# `eg-wheelhouse`, fed to BOTH backends identically. DELETE EG_WHEELHOUSE_PATH
# (here, in docker/Dockerfile, and in docker/deploy.sh's docs) the moment
# PyPI's epistemic-graph catches up to agent-utilities' declared floor.
#
# Usage:
#   docker/build_and_push.sh [--push] [--tag TAG] [--backend auto|docker|buildkit]
#
# Env overrides (all optional except EG_WHEELHOUSE_PATH, see above):
#   AU_SRC_PATH         path to an agent-utilities checkout (default: ../agent-utilities)
#   EG_WHEELHOUSE_PATH  REQUIRED (temporary, see above): a directory containing
#                        a pre-built epistemic_graph-*.whl at >=2.23.2,<3.0.0
#   IMAGE               image name:tag prefix (default: knucklessg1/agent-webui)
#   BUILD_BACKEND       auto (default) | docker | buildkit -- see detection order above
#   DOCKER               full docker invocation to use verbatim if set (bypasses
#                        the local-daemon/DOCKER_CONTEXT probe below entirely)
#   DOCKER_BIN           docker binary to invoke (default: docker)
#   DOCKER_CONTEXT        docker context to fall back to if no local daemon is
#                        reachable (default: r820)
#   DOCKER_BUILDER        buildx builder to build with, explicitly (default:
#                        "default", buildx's own name for the resolved
#                        context's daemon-embedded builder) -- never left to
#                        whatever the host's AMBIENT current builder happens
#                        to be, see build_and_push_docker's comment
#   BUILDKIT_NAMESPACE  k8s namespace hosting the buildkitd Service (default: image-build)
#   BUILDKIT_SERVICE    Service name to resolve (default: buildkitd)
#   BUILDKIT_ADDR       full buildctl --addr value; overrides the two vars above
#                        (e.g. tcp://10.0.0.1:1234) if the ClusterIP is already known
#   BUILDCTL            buildctl binary to invoke (default: buildctl)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AU_SRC_PATH="${AU_SRC_PATH:-${REPO_ROOT}/../agent-utilities}"
IMAGE="${IMAGE:-knucklessg1/agent-webui}"
BUILD_BACKEND="${BUILD_BACKEND:-auto}"
DOCKER_BIN="${DOCKER_BIN:-docker}"
DOCKER_CONTEXT="${DOCKER_CONTEXT:-r820}"
BUILDKIT_NAMESPACE="${BUILDKIT_NAMESPACE:-image-build}"
BUILDKIT_SERVICE="${BUILDKIT_SERVICE:-buildkitd}"
BUILDCTL="${BUILDCTL:-buildctl}"

PUSH=0
TAG="$(cd "${REPO_ROOT}" && git rev-parse --short HEAD)"
while [ $# -gt 0 ]; do
  case "$1" in
    --push) PUSH=1; shift ;;
    --tag) TAG="$2"; shift 2 ;;
    --backend) BUILD_BACKEND="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 64 ;;
  esac
done

log() { echo "[build_and_push.sh] $*" >&2; }

# ── Backend seam: probe, select, report ─────────────────────────────────────
probe_docker() {
  if [ -n "${DOCKER:-}" ]; then
    if ${DOCKER} version >/dev/null 2>&1; then
      DOCKER_CMD="${DOCKER}"
      BACKEND_REASON="DOCKER explicitly set (\"${DOCKER}\"), reachable"
      return 0
    fi
    DOCKER_PROBE_ERR="DOCKER explicitly set (\"${DOCKER}\") but unreachable"
    return 1
  fi
  if "${DOCKER_BIN}" version >/dev/null 2>&1; then
    DOCKER_CMD="${DOCKER_BIN}"
    BACKEND_REASON="local default docker daemon reachable"
    return 0
  fi
  if "${DOCKER_BIN}" --context "${DOCKER_CONTEXT}" version >/dev/null 2>&1; then
    DOCKER_CMD="${DOCKER_BIN} --context ${DOCKER_CONTEXT}"
    BACKEND_REASON="docker context '${DOCKER_CONTEXT}' reachable"
    return 0
  fi
  DOCKER_PROBE_ERR="no local docker daemon, and context '${DOCKER_CONTEXT}' unreachable (is r820 up? 'docker context ls' shows it configured?)"
  return 1
}

probe_buildkit() {
  if [ -n "${BUILDKIT_ADDR:-}" ]; then
    RESOLVED_ADDR="${BUILDKIT_ADDR}"
  else
    if ! command -v kubectl >/dev/null 2>&1; then
      BUILDKIT_PROBE_ERR="kubectl not found and BUILDKIT_ADDR not set -- cannot resolve the buildkitd Service address"
      return 1
    fi
    local cluster_ip
    cluster_ip="$(kubectl -n "${BUILDKIT_NAMESPACE}" get svc "${BUILDKIT_SERVICE}" \
      -o jsonpath='{.spec.clusterIP}' 2>/dev/null || true)"
    if [ -z "${cluster_ip}" ]; then
      BUILDKIT_PROBE_ERR="could not resolve Service ${BUILDKIT_NAMESPACE}/${BUILDKIT_SERVICE}'s clusterIP -- cluster unreachable, or services/buildkit-service/k8s/buildkitd.yaml not applied"
      return 1
    fi
    RESOLVED_ADDR="tcp://${cluster_ip}:1234"
  fi
  if ! "${BUILDCTL}" --addr "${RESOLVED_ADDR}" debug workers >/dev/null 2>&1; then
    BUILDKIT_PROBE_ERR="buildkitd at ${RESOLVED_ADDR} unreachable -- check 'kubectl -n ${BUILDKIT_NAMESPACE} get pods -l app=buildkitd'"
    return 1
  fi
  BACKEND_REASON="buildkitd reachable at ${RESOLVED_ADDR} (namespace ${BUILDKIT_NAMESPACE}, Service ${BUILDKIT_SERVICE})"
  return 0
}

select_backend() {
  case "${BUILD_BACKEND}" in
    docker)
      probe_docker || { log "FAILED: BUILD_BACKEND=docker forced, but ${DOCKER_PROBE_ERR}."; exit 69; }
      BACKEND=docker
      ;;
    buildkit)
      probe_buildkit || { log "FAILED: BUILD_BACKEND=buildkit forced, but ${BUILDKIT_PROBE_ERR}."; exit 69; }
      BACKEND=buildkit
      ;;
    auto)
      if probe_docker; then
        BACKEND=docker
      elif probe_buildkit; then
        BACKEND=buildkit
      else
        log "FAILED: no build backend available."
        log "  docker:   ${DOCKER_PROBE_ERR}"
        log "  buildkit: ${BUILDKIT_PROBE_ERR}"
        log "Do NOT start dockerd on r820 to work around this -- it is the sole" \
            "k8s control-plane node, cannot be safely rebooted, and dockerd's" \
            "iptables rewrites can disrupt cilium on a live cluster."
        exit 69
      fi
      ;;
    *)
      log "FAILED: unknown BUILD_BACKEND '${BUILD_BACKEND}' (expected auto|docker|buildkit)"
      exit 64
      ;;
  esac
  log "Build backend: ${BACKEND} (${BACKEND_REASON})"
}

# ── Shared trap-enforcing check: the ONE place that asserts build-info.txt ──
# matches this exact commit and today's date. Both backends call this against
# whatever text their own (necessarily different, see header) retrieval
# mechanism captured.
assert_build_info() {
  local info="$1"
  echo "${info}" | sed 's/^/  /' >&2
  if ! grep -q "sha=${BUILD_SHA}$" <<<"${info}"; then
    log "FAILED: build-info.txt does not carry sha=${BUILD_SHA} -- the served bundle is NOT today's commit."
    return 1
  fi
  local today
  today="$(date -u +%Y-%m-%d)"
  if ! grep -q "built_at=${today}" <<<"${info}"; then
    log "FAILED: build-info.txt built_at is not dated ${today} (UTC)."
    return 1
  fi
  log "OK: served bundle verified to carry sha=${BUILD_SHA}, built ${today}."
  return 0
}

select_backend

if [ ! -d "${AU_SRC_PATH}" ]; then
  log "AU_SRC_PATH does not exist: ${AU_SRC_PATH}"
  log "set AU_SRC_PATH to an agent-utilities checkout (source, not a wheel)"
  exit 66
fi
if ! grep -q '^name = "agent-utilities"' "${AU_SRC_PATH}/pyproject.toml" 2>/dev/null; then
  log "AU_SRC_PATH does not look like an agent-utilities source checkout" \
      "(no pyproject.toml declaring name=\"agent-utilities\"): ${AU_SRC_PATH}"
  log "this build NEVER installs agent-utilities from PyPI (D-W5WR-1) -- it must be a real source tree"
  exit 66
fi

# ── TEMPORARY (see header): epistemic-graph wheelhouse, required by BOTH backends
if [ -z "${EG_WHEELHOUSE_PATH:-}" ]; then
  log "FAILED: EG_WHEELHOUSE_PATH is not set."
  log "epistemic-graph's PyPI releases (newest: 2.23.0) do not yet satisfy" \
      "agent-utilities' graphos extra floor (>=2.23.2,<3.0.0) -- see this" \
      "script's header for the full explanation. Set EG_WHEELHOUSE_PATH to a" \
      "directory containing a pre-built epistemic_graph-*.whl at a satisfying" \
      "version (a shared one may already exist under a wheelhouse location" \
      "other lanes populate, or build one from the epistemic-graph checkout" \
      "with 'maturin build --release --features full')."
  exit 66
fi
if [ ! -d "${EG_WHEELHOUSE_PATH}" ] || ! ls "${EG_WHEELHOUSE_PATH}"/epistemic_graph-*.whl >/dev/null 2>&1; then
  log "EG_WHEELHOUSE_PATH does not contain an epistemic_graph-*.whl: ${EG_WHEELHOUSE_PATH}"
  exit 66
fi

BUILD_SHA="$(cd "${REPO_ROOT}" && git rev-parse --short HEAD)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Push destination(s) for THIS invocation. --build-only never touches the real
# release tags (see header) -- under BuildKit it pushes to a throwaway tag
# purely so the build-info.txt check has something to pull and run; under
# docker it never pushes anything at all (verified from the local tag).
if [ "${PUSH}" -eq 1 ]; then
  LATEST_TAG="${IMAGE}:latest"
else
  LATEST_TAG="${IMAGE}:buildcheck-${TAG}"
fi

docker_get_build_info() {
  local image_ref="$1"
  ${DOCKER_CMD} run --rm --entrypoint sh "${image_ref}" -c \
    'cat "$(python3 -c "import agent_webui, os; print(os.path.join(os.path.dirname(agent_webui.__file__), \"dist\", \"build-info.txt\"))")"'
}

build_and_push_docker() {
  log "Building ${IMAGE}:${TAG} via docker (${DOCKER_CMD})" \
      "(au-src=${AU_SRC_PATH}, eg-wheelhouse=${EG_WHEELHOUSE_PATH}, sha=${BUILD_SHA})"
  # `buildx build --builder "${DOCKER_BUILDER}"` (not a bare `docker build`):
  # discovered running this for real -- a host's AMBIENT "current" buildx
  # builder (`docker buildx ls`'s `*`-marked entry, ~/.docker/buildx state,
  # entirely outside this script's control) can be a stale/broken remote
  # builder someone configured for an unrelated purpose, and a bare
  # `docker build` silently routes through it. Pinning `--builder default` --
  # buildx's own built-in name for "this docker context's own daemon-embedded
  # builder", always present wherever a daemon is -- makes this script
  # immune to whatever the ambient default happens to be, without mutating
  # that ambient state (`docker buildx use ...` would, and would surprise
  # other work on a shared dev host).
  ${DOCKER_CMD} buildx build --builder "${DOCKER_BUILDER:-default}" \
    -f "${REPO_ROOT}/docker/Dockerfile" \
    --build-context au-src="${AU_SRC_PATH}" \
    --build-context eg-wheelhouse="${EG_WHEELHOUSE_PATH}" \
    --build-arg BUILD_SHA="${BUILD_SHA}" \
    --build-arg BUILD_TIME="${BUILD_TIME}" \
    -t "${IMAGE}:${TAG}" \
    -t "${LATEST_TAG}" \
    "${REPO_ROOT}" >&2

  # Verify BEFORE push: docker's local daemon store lets this run against the
  # freshly built image with nothing published anywhere yet (see header).
  log "Verifying build-info.txt inside the freshly built image..."
  local info
  info="$(docker_get_build_info "${IMAGE}:${TAG}")"
  assert_build_info "${info}" || exit 70

  if [ "${PUSH}" -eq 1 ]; then
    log "Pushing ${IMAGE}:${TAG} and ${LATEST_TAG}"
    ${DOCKER_CMD} push "${IMAGE}:${TAG}" >&2
    ${DOCKER_CMD} push "${LATEST_TAG}" >&2
    local full_digest
    full_digest="$(${DOCKER_CMD} inspect --format='{{index .RepoDigests 0}}' "${LATEST_TAG}")"
    PUSHED_DIGEST_RAW="${full_digest#*@}"
  fi
}

build_and_push_buildkit() {
  log "Building ${IMAGE}:${TAG} via buildkitd@${RESOLVED_ADDR}" \
      "(au-src=${AU_SRC_PATH}, eg-wheelhouse=${EG_WHEELHOUSE_PATH}, sha=${BUILD_SHA})"
  local metadata_file
  metadata_file="$(mktemp /var/tmp/agent-webui-build-meta.XXXXXX.json)"
  # shellcheck disable=SC2064
  trap "rm -f '${metadata_file}'" RETURN
  "${BUILDCTL}" --addr "${RESOLVED_ADDR}" build \
    --frontend dockerfile.v0 \
    --local context="${REPO_ROOT}" \
    --local dockerfile="${REPO_ROOT}/docker" \
    --local au-src="${AU_SRC_PATH}" \
    --opt context:au-src=local:au-src \
    --local eg-wheelhouse="${EG_WHEELHOUSE_PATH}" \
    --opt context:eg-wheelhouse=local:eg-wheelhouse \
    --opt build-arg:BUILD_SHA="${BUILD_SHA}" \
    --opt build-arg:BUILD_TIME="${BUILD_TIME}" \
    --output "type=image,\"name=${IMAGE}:${TAG},${LATEST_TAG}\",push=true" \
    --metadata-file "${metadata_file}" \
    --progress plain >&2

  PUSHED_DIGEST_RAW="$(python3 -c "import json; print(json.load(open('${metadata_file}'))['containerimage.digest'])")"
  if [ -z "${PUSHED_DIGEST_RAW}" ]; then
    log "FAILED: buildctl did not report a containerimage.digest in its metadata file -- cannot verify or report the pushed image."
    exit 71
  fi

  # Verify AFTER push: BuildKit has no local store to run against (see header).
  local verify_ref="${IMAGE}@${PUSHED_DIGEST_RAW}"
  log "Verifying build-info.txt inside the freshly pushed image (${verify_ref})..."
  local verify_pod="agent-webui-buildcheck-${BUILD_SHA}"
  kubectl -n "${BUILDKIT_NAMESPACE}" delete pod "${verify_pod}" --ignore-not-found >&2
  local info
  info="$(kubectl -n "${BUILDKIT_NAMESPACE}" run "${verify_pod}" \
    --image="${verify_ref}" --restart=Never --rm --attach --pod-running-timeout=240s \
    --command -- python3 -c \
    'import agent_webui, os
p = os.path.join(os.path.dirname(agent_webui.__file__), "dist", "build-info.txt")
print(open(p).read())')"
  assert_build_info "${info}" || exit 70
}

case "${BACKEND}" in
  docker) build_and_push_docker ;;
  buildkit) build_and_push_buildkit ;;
esac

if [ "${PUSH}" -eq 1 ]; then
  PUSHED_DIGEST="${IMAGE}@${PUSHED_DIGEST_RAW}"
  log "Pushed ${IMAGE}:${TAG} and ${IMAGE}:latest -- digest ${PUSHED_DIGEST_RAW}"
  log "Record this digest before rolling the deployment -- it is the ONLY way back to this exact image once :latest moves again."
  # Machine-parseable line on stdout for docker/deploy.sh (or any other caller) to
  # capture via `grep '^PUSHED_DIGEST='`. Everything else in this script writes to
  # stderr specifically so stdout stays parseable.
  echo "PUSHED_DIGEST=${PUSHED_DIGEST}"
  echo "BUILD_SHA=${BUILD_SHA}"
  echo "BUILD_TIME=${BUILD_TIME}"
else
  log "MODE=build-only: verified locally only, no real release tags touched" \
      "(backend=${BACKEND}). Re-run with --push (or via docker/deploy.sh) to" \
      "actually publish :latest/:${TAG}."
fi
