#!/usr/bin/env bash
# Build (and optionally push) the agent-webui runtime image (D-WUI-30). Wraps the
# exact `buildctl build` invocation documented in the Dockerfile header so cutting an
# image is one command, not the multi-step manual process used to reconstruct this
# pipeline in the first place.
#
# THIS SCRIPT IS NOT THE OPERATOR ENTRYPOINT. It builds (and, with --push,
# publishes) the image; it never touches the live cluster. For a full local
# release -- build, verify, push, deploy, verify the rollout -- run
# `docker/deploy.sh` instead, which calls this script internally. Kept as a
# separate file (single responsibility: build/push only) so it can also be
# invoked standalone for a build-only smoke test.
#
# ── 2026-08-17: migrated off the r820 docker daemon onto cluster-native BuildKit ──
# r820 was the only host in this cluster with a working `docker build` daemon (a
# leftover from the pre-cutover Swarm era). It was deliberately stopped when docker
# was sunset in the Swarm->RKE2 migration (2026-07-11), so this script started
# failing outright with "cannot reach the docker daemon via context 'r820'". The
# fix is NOT to start dockerd back up on r820 -- it is the sole k8s control-plane
# node, cannot be safely rebooted (halts at POST awaiting a keypress, and its iDRAC
# password lives in the OpenBao it would take down), and a docker daemon rewrites
# iptables in ways that can disrupt cilium on a live cluster.
#
# Instead, this script now builds against `buildkitd`, a shared BuildKit
# Deployment running INSIDE the cluster, spread across TWO worker nodes (r510,
# r710 -- see services/buildkit-service/k8s/buildkitd.yaml for the full node-
# placement rationale, including why r820, gb10, and rw710 are all deliberately
# excluded). This is a reusable PLATFORM capability, not webui-specific --
# services/buildkit-service/README.md documents the same buildctl invocation
# pattern for any other repo in the workspace. Resolving its address at
# runtime (not hardcoding the ClusterIP, which is not stable across recreates):
#
#   kubectl -n image-build get svc buildkitd -o jsonpath='{.spec.clusterIP}'
#
# `buildctl` (the BuildKit CLI client) ships in the `nerdctl-full` release
# tarball (https://github.com/containerd/nerdctl/releases, bin/buildctl) --
# install it once per dev host, no daemon required locally.
#
# WHY THE EXTRA BUILD CONTEXT: agent-webui's runtime imports
# agent_utilities.security.persistence_privacy and friends at module load,
# but PyPI's newest agent-utilities (1.26.4) doesn't have that module -- see
# the Dockerfile header for the full empirical trail. So the build needs
# agent-utilities' actual source tree (built into a wheel in-image, no Rust
# required; the compiled engine ships separately as epistemic-graph, resolved
# from the default PyPI index like any other dependency since it's a hard
# base dependency of agent-utilities' own pyproject.toml). NEVER "simplify"
# this to `pip install agent-utilities[...]` -- that silently resolves from
# stale PyPI (D-W5WR-1) and crash-loops production on a missing module. The
# Dockerfile's `COPY --from=au-src` already uses Docker's named-build-context
# form, which maps 1:1 onto buildctl's `--opt context:au-src=local:au-src`
# (see below) -- no Dockerfile changes were needed for this migration.
#
# WHY build-info.txt, AND WHY THE CHECK MOVED: baked into the served SPA bundle
# at BUILD_SHA/BUILT_AT (see Dockerfile's frontend-build stage) -- this is what
# actually catches "the build succeeded but shipped stale/wrong frontend code,"
# the exact class of bug that made D-WUI-30 necessary in the first place. Under
# `docker build`, the image landed in a LOCAL daemon store, so this could be
# verified by `docker run --rm` BEFORE anything was pushed anywhere. BuildKit's
# client/server model has no such local store to run against: buildctl's only
# way to materialize a built image for inspection is one of its exporters, and
# the only exporter that produces something a throwaway pod can `docker
# pull`-equivalent run is `type=image,push=true` -- i.e. the image must already
# be IN the registry to be inspected. So the check now runs immediately AFTER
# push, BEFORE `docker/deploy.sh` ever calls `kubectl set image` -- the same
# gate, resequenced, still fully blocking the one thing that matters (nothing
# gets deployed that doesn't carry today's build-info.txt). `--build-only` mode
# (no real release push) still needs an exporter target to verify against, so
# it pushes to a throwaway `:buildcheck-<sha>` tag instead of `:latest`/`:TAG`
# -- never the tags a real release or `docker/deploy.sh` would deploy by digest.
#
# Usage:
#   docker/build_and_push.sh [--push] [--tag TAG]
#
# Env overrides (all optional):
#   AU_SRC_PATH         path to an agent-utilities checkout (default: ../agent-utilities)
#   EG_WHEELHOUSE_PATH  REQUIRED (temporary, see docker/Dockerfile header): a
#                        directory containing a pre-built epistemic_graph-*.whl
#                        at >=2.23.2,<3.0.0 -- PyPI's newest release (2.23.0)
#                        does not yet satisfy agent-utilities' `graphos` extra
#   IMAGE               image name:tag prefix (default: knucklessg1/agent-webui)
#   BUILDKIT_NAMESPACE  k8s namespace hosting the buildkitd Service (default: image-build)
#   BUILDKIT_SERVICE    Service name to resolve (default: buildkitd)
#   BUILDKIT_ADDR       full buildctl --addr value; overrides the two vars above
#                        (e.g. tcp://10.0.0.1:1234) if the ClusterIP is already known
#   BUILDCTL            buildctl binary to invoke (default: buildctl)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AU_SRC_PATH="${AU_SRC_PATH:-${REPO_ROOT}/../agent-utilities}"
IMAGE="${IMAGE:-knucklessg1/agent-webui}"
BUILDKIT_NAMESPACE="${BUILDKIT_NAMESPACE:-image-build}"
BUILDKIT_SERVICE="${BUILDKIT_SERVICE:-buildkitd}"
BUILDCTL="${BUILDCTL:-buildctl}"

PUSH=0
TAG="$(cd "${REPO_ROOT}" && git rev-parse --short HEAD)"
while [ $# -gt 0 ]; do
  case "$1" in
    --push) PUSH=1; shift ;;
    --tag) TAG="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 64 ;;
  esac
done

# ── Preflight: resolve buildkitd's address, refuse to silently build nowhere ────
if [ -n "${BUILDKIT_ADDR:-}" ]; then
  RESOLVED_ADDR="${BUILDKIT_ADDR}"
else
  if ! command -v kubectl >/dev/null 2>&1; then
    echo "FAILED: kubectl not found and BUILDKIT_ADDR not set -- cannot resolve" \
         "the buildkitd Service address. Install kubectl or set BUILDKIT_ADDR" \
         "explicitly (tcp://<ip>:1234)." >&2
    exit 69
  fi
  CLUSTER_IP="$(kubectl -n "${BUILDKIT_NAMESPACE}" get svc "${BUILDKIT_SERVICE}" \
    -o jsonpath='{.spec.clusterIP}' 2>/dev/null || true)"
  if [ -z "${CLUSTER_IP}" ]; then
    echo "FAILED: could not resolve Service ${BUILDKIT_NAMESPACE}/${BUILDKIT_SERVICE}'s" \
         "clusterIP. Is the cluster reachable (kubectl config current-context)? Is" \
         "the buildkitd Deployment/Service applied (see" \
         "services/buildkit-service/k8s/buildkitd.yaml)? Do NOT work around this by" \
         "starting a docker daemon on r820 -- see this script's header." >&2
    exit 69
  fi
  RESOLVED_ADDR="tcp://${CLUSTER_IP}:1234"
fi
if ! "${BUILDCTL}" --addr "${RESOLVED_ADDR}" debug workers >/dev/null 2>&1; then
  cat >&2 <<EOF
FAILED: cannot reach buildkitd at ${RESOLVED_ADDR}.

This means the shared buildkitd Deployment (namespace
${BUILDKIT_NAMESPACE}, Service ${BUILDKIT_SERVICE}) is unreachable -- check
'kubectl -n ${BUILDKIT_NAMESPACE} get pods -l app=buildkitd' for pod health,
and 'kubectl -n ${BUILDKIT_NAMESPACE} get svc ${BUILDKIT_SERVICE}' for the
Service. Fix connectivity/health and retry; do NOT work around this by
starting a docker daemon on r820 (sole k8s control-plane node, unsafe to
touch -- see this script's header) or pointing at some other ad hoc daemon.
EOF
  exit 69
fi

if [ ! -d "${AU_SRC_PATH}" ]; then
  echo "AU_SRC_PATH does not exist: ${AU_SRC_PATH}" >&2
  echo "set AU_SRC_PATH to an agent-utilities checkout (source, not a wheel)" >&2
  exit 66
fi
if ! grep -q '^name = "agent-utilities"' "${AU_SRC_PATH}/pyproject.toml" 2>/dev/null; then
  echo "AU_SRC_PATH does not look like an agent-utilities source checkout" \
       "(no pyproject.toml declaring name=\"agent-utilities\"): ${AU_SRC_PATH}" >&2
  echo "this build NEVER installs agent-utilities from PyPI (D-W5WR-1) --" \
       "it must be a real source tree" >&2
  exit 66
fi

# ── TEMPORARY (see docker/Dockerfile header, 2026-08-17): epistemic-graph's
# PyPI publishing has not caught up to agent-utilities' declared `graphos`
# extra floor (>=2.23.2,<3.0.0; PyPI's newest is 2.23.0), so a pre-built wheel
# must be supplied out of band. Delete this whole block (and the matching
# Dockerfile context) once PyPI's epistemic-graph satisfies that floor.
if [ -z "${EG_WHEELHOUSE_PATH:-}" ]; then
  echo "FAILED: EG_WHEELHOUSE_PATH is not set." >&2
  echo "epistemic-graph's PyPI releases (newest: 2.23.0) do not yet satisfy" \
       "agent-utilities' graphos extra floor (>=2.23.2,<3.0.0) -- see" \
       "docker/Dockerfile's header for the full explanation. Set" \
       "EG_WHEELHOUSE_PATH to a directory containing a pre-built" \
       "epistemic_graph-*.whl at a satisfying version (a shared one may" \
       "already exist -- check for epistemic_graph-*.whl under a wheelhouse" \
       "location other lanes populate, or build one from the epistemic-graph" \
       "checkout with 'maturin build --release --features full')." >&2
  exit 66
fi
if [ ! -d "${EG_WHEELHOUSE_PATH}" ] || ! ls "${EG_WHEELHOUSE_PATH}"/epistemic_graph-*.whl >/dev/null 2>&1; then
  echo "EG_WHEELHOUSE_PATH does not contain an epistemic_graph-*.whl:" \
       "${EG_WHEELHOUSE_PATH}" >&2
  exit 66
fi
BUILD_SHA="$(cd "${REPO_ROOT}" && git rev-parse --short HEAD)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Push destination(s) for THIS invocation. --build-only never touches the real
# release tags (see header) -- it pushes to a throwaway tag purely so the
# build-info.txt check below has something to pull and run.
if [ "${PUSH}" -eq 1 ]; then
  OUTPUT_NAMES="${IMAGE}:${TAG},${IMAGE}:latest"
else
  OUTPUT_NAMES="${IMAGE}:buildcheck-${TAG}"
fi

echo "Building ${IMAGE}:${TAG} via buildkitd@${RESOLVED_ADDR}" \
     "(au-src=${AU_SRC_PATH}, eg-wheelhouse=${EG_WHEELHOUSE_PATH}, sha=${BUILD_SHA})" >&2
METADATA_FILE="$(mktemp /var/tmp/agent-webui-build-meta.XXXXXX.json)"
trap 'rm -f "${METADATA_FILE}"' EXIT
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
  --output "type=image,\"name=${OUTPUT_NAMES}\",push=true" \
  --metadata-file "${METADATA_FILE}" \
  --progress plain >&2

PUSHED_DIGEST_RAW="$(python3 -c "import json; print(json.load(open('${METADATA_FILE}'))['containerimage.digest'])")"
if [ -z "${PUSHED_DIGEST_RAW}" ]; then
  echo "FAILED: buildctl did not report a containerimage.digest in its metadata" \
       "file -- cannot verify or (if --push) report the pushed image. Aborting." >&2
  exit 71
fi
# Verify by DIGEST, not by either pushed tag -- unambiguous, and works the same
# whether this is a --build-only throwaway push or a real --push release.
VERIFY_REF="${IMAGE}@${PUSHED_DIGEST_RAW}"

# ── Verify the SERVED bundle carries this build, via a throwaway in-cluster pod ─
# Extracts build-info.txt from the image just pushed (not from disk, not from an
# assumption) and asserts it names this exact commit and today's date. Catches "the
# build succeeded but baked a stale/cached frontend layer" before docker/deploy.sh
# ever runs `kubectl set image` against the live Deployment (see header for why
# this check now runs after push instead of before, under BuildKit's model).
echo "Verifying build-info.txt inside the freshly pushed image (${VERIFY_REF})..." >&2
VERIFY_POD="agent-webui-buildcheck-${BUILD_SHA}"
kubectl -n "${BUILDKIT_NAMESPACE}" delete pod "${VERIFY_POD}" --ignore-not-found >&2
BUILD_INFO="$(kubectl -n "${BUILDKIT_NAMESPACE}" run "${VERIFY_POD}" \
  --image="${VERIFY_REF}" --restart=Never --rm --pod-running-timeout=120s \
  --command -- python3 -c \
  'import agent_webui, os
p = os.path.join(os.path.dirname(agent_webui.__file__), "dist", "build-info.txt")
print(open(p).read())')"
echo "${BUILD_INFO}" | sed 's/^/  /' >&2
if ! grep -q "sha=${BUILD_SHA}$" <<<"${BUILD_INFO}"; then
  echo "FAILED: build-info.txt in the pushed image does not carry sha=${BUILD_SHA}" \
       "-- the served bundle is NOT today's commit." >&2
  exit 70
fi
TODAY_UTC="$(date -u +%Y-%m-%d)"
if ! grep -q "built_at=${TODAY_UTC}" <<<"${BUILD_INFO}"; then
  echo "FAILED: build-info.txt built_at is not dated ${TODAY_UTC} (UTC)." >&2
  exit 70
fi
echo "OK: served bundle verified to carry sha=${BUILD_SHA}, built ${TODAY_UTC}." >&2

if [ "${PUSH}" -eq 1 ]; then
  PUSHED_DIGEST="${IMAGE}@${PUSHED_DIGEST_RAW}"
  echo "Pushed ${IMAGE}:${TAG} and ${IMAGE}:latest -- digest ${PUSHED_DIGEST_RAW}" >&2
  echo "Record this digest before rolling the deployment -- it is the ONLY" \
       "way back to this exact image once :latest moves again." >&2
  # Machine-parseable line on stdout for docker/deploy.sh (or any other caller) to
  # capture via `grep '^PUSHED_DIGEST='`. Everything else in this script writes to
  # stderr specifically so stdout stays parseable.
  echo "PUSHED_DIGEST=${PUSHED_DIGEST}"
  echo "BUILD_SHA=${BUILD_SHA}"
  echo "BUILD_TIME=${BUILD_TIME}"
else
  echo "MODE=build-only: pushed a throwaway verification tag" \
       "(${IMAGE}:buildcheck-${TAG}) only -- not a real release tag. Re-run with" \
       "--push (or via docker/deploy.sh) to actually publish :latest/:${TAG}." >&2
fi
