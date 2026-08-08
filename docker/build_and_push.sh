#!/usr/bin/env bash
# Build (and optionally push) the agent-webui runtime image (D-WUI-30). Wraps the
# exact `docker build` invocation documented in the Dockerfile header so cutting an
# image is one command, not the multi-step manual process used to reconstruct this
# pipeline in the first place.
#
# THIS SCRIPT IS NOT THE OPERATOR ENTRYPOINT. It builds (and, with --push,
# publishes) the image; it never touches the live cluster. For a full local
# release -- build, verify, push, deploy, verify the rollout -- run
# `docker/deploy.sh` instead, which calls this script internally. Kept as a
# separate file (single responsibility: docker build/push only) so it can also be
# invoked standalone for a build-only smoke test.
#
# WHY ALWAYS ON r820, REGARDLESS OF WHERE THIS SCRIPT RUNS: rw710 (and most other
# workspace hosts) have no local docker daemon at all (containerd/RKE2 only) --
# `docker build` there fails immediately with "no such file or directory" on the
# socket, which is an honest but unhelpful failure (it doesn't say WHERE to build
# instead). r820 is the one host in this cluster still running a docker daemon
# suitable for `docker build`/buildx. Rather than requiring the operator to `ssh
# r820` by hand (silently build-anywhere-that-happens-to-have-a-daemon was exactly
# how the original stale-image incidents happened), this script always targets
# r820's docker daemon via the pre-configured `docker context` (`docker context ls`
# shows `r820 -> ssh://genius@10.0.0.13`) -- so the SAME command works from any dev
# host and always builds in the same place, never a host-dependent "wherever a
# daemon happens to be reachable." Override only if you know what you're doing
# (DOCKER_CONTEXT=default requires a local daemon).
#
# WHY TWO EXTRA BUILD CONTEXTS: agent-webui's runtime imports
# agent_utilities.security.persistence_privacy and friends at module load,
# but PyPI's newest agent-utilities (1.26.4) doesn't have that module, and
# agent-utilities' own dependency floor (epistemic-graph[full]>=2.23.2) is
# ahead of PyPI's newest epistemic-graph (2.23.0) too -- see the Dockerfile
# header for the full empirical trail. So the build needs agent-utilities'
# actual source tree (built into a wheel in-image, no Rust required) and a
# pre-built epistemic-graph wheel (the Rust engine; rebuilding it here would
# need a cargo/maturin toolchain this image doesn't carry). NEVER "simplify"
# this to `pip install agent-utilities[...]` -- that silently resolves from
# stale PyPI (D-W5WR-1) and crash-loops production on a missing module.
#
# WHY build-info.txt: baked into the served SPA bundle at BUILD_SHA/BUILT_AT
# (see Dockerfile's frontend-build stage) and verified below BEFORE any push --
# this is what actually catches "the build succeeded but shipped stale/wrong
# frontend code," the exact class of bug that made D-WUI-30 necessary in the
# first place.
#
# Usage:
#   docker/build_and_push.sh [--push] [--tag TAG]
#
# Env overrides (all optional; defaults match the sibling layout this repo
# is normally checked out in -- see plans/au-eg-program/designs/
# design-remote-build-hosts-2026-08-06.md for the r820 buildhost layout):
#   AU_SRC_PATH       path to an agent-utilities checkout (default: ../agent-utilities)
#   WHEELHOUSE_PATH   directory containing epistemic_graph-*.whl
#                     (default: ../../.dev-wheelhouse)
#   IMAGE             image name:tag prefix (default: knucklessg1/agent-webui)
#   DOCKER_CONTEXT    docker context to build in (default: r820; see above)
#   DOCKER            docker binary to invoke (default: docker)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AU_SRC_PATH="${AU_SRC_PATH:-${REPO_ROOT}/../agent-utilities}"
WHEELHOUSE_PATH="${WHEELHOUSE_PATH:-${REPO_ROOT}/../../.dev-wheelhouse}"
IMAGE="${IMAGE:-knucklessg1/agent-webui}"
DOCKER_CONTEXT="${DOCKER_CONTEXT:-r820}"
DOCKER="${DOCKER:-docker --context ${DOCKER_CONTEXT}}"

PUSH=0
TAG="$(cd "${REPO_ROOT}" && git rev-parse --short HEAD)"
while [ $# -gt 0 ]; do
  case "$1" in
    --push) PUSH=1; shift ;;
    --tag) TAG="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 64 ;;
  esac
done

# ── Preflight: refuse to silently build on the wrong (or no) daemon ─────────────
if ! ${DOCKER} version >/dev/null 2>&1; then
  cat >&2 <<EOF
FAILED: cannot reach the docker daemon via context '${DOCKER_CONTEXT}'.

This is expected on hosts with no local docker daemon (e.g. rw710 -- RKE2/
containerd only, by design) and is why this script targets r820 by default
instead of the local daemon. This failure means the r820 build host itself is
unreachable (SSH down, r820 offline, or the 'r820' docker context is missing
-- check 'docker context ls'). Fix connectivity to r820 and retry; do NOT
work around this by pointing DOCKER_CONTEXT at some other host's daemon, or
you risk building on a host nobody expects images to come from.
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
if ! ls "${WHEELHOUSE_PATH}"/epistemic_graph-*.whl >/dev/null 2>&1; then
  echo "WHEELHOUSE_PATH has no epistemic_graph-*.whl: ${WHEELHOUSE_PATH}" >&2
  echo "set WHEELHOUSE_PATH to a directory containing a pre-built wheel" \
       "matching agent-utilities' epistemic-graph[full] floor" >&2
  exit 66
fi

BUILD_SHA="$(cd "${REPO_ROOT}" && git rev-parse --short HEAD)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "Building ${IMAGE}:${TAG} on docker context '${DOCKER_CONTEXT}'" \
     "(au-src=${AU_SRC_PATH}, wheelhouse=${WHEELHOUSE_PATH}, sha=${BUILD_SHA})" >&2
${DOCKER} build -f "${REPO_ROOT}/docker/Dockerfile" \
  --build-context au-src="${AU_SRC_PATH}" \
  --build-context wheelhouse="${WHEELHOUSE_PATH}" \
  --build-arg BUILD_SHA="${BUILD_SHA}" \
  --build-arg BUILD_TIME="${BUILD_TIME}" \
  -t "${IMAGE}:${TAG}" \
  -t "${IMAGE}:latest" \
  "${REPO_ROOT}"

# ── Verify the SERVED bundle carries this build BEFORE pushing anything ─────────
# Extracts build-info.txt from the image just built (not from disk, not from an
# assumption) and asserts it names this exact commit and today's date. Catches "the
# build succeeded but baked a stale/cached frontend layer" before it ever reaches a
# registry, let alone production.
echo "Verifying build-info.txt inside the freshly built image..." >&2
BUILD_INFO="$(${DOCKER} run --rm --entrypoint sh "${IMAGE}:${TAG}" -c \
  'cat "$(python3 -c "import agent_webui, os; print(os.path.join(os.path.dirname(agent_webui.__file__), \"dist\", \"build-info.txt\"))")"')"
echo "${BUILD_INFO}" | sed 's/^/  /' >&2
if ! grep -q "sha=${BUILD_SHA}$" <<<"${BUILD_INFO}"; then
  echo "FAILED: build-info.txt in the built image does not carry sha=${BUILD_SHA}" \
       "-- the served bundle would NOT be today's commit. Refusing to push." >&2
  exit 70
fi
TODAY_UTC="$(date -u +%Y-%m-%d)"
if ! grep -q "built_at=${TODAY_UTC}" <<<"${BUILD_INFO}"; then
  echo "FAILED: build-info.txt built_at is not dated ${TODAY_UTC} (UTC)." >&2
  exit 70
fi
echo "OK: served bundle verified to carry sha=${BUILD_SHA}, built ${TODAY_UTC}." >&2

DIGEST="$(${DOCKER} inspect --format='{{index .RepoDigests 0}}' "${IMAGE}:${TAG}" 2>/dev/null || echo "(local build, no digest until pushed)")"
echo "Built ${IMAGE}:${TAG} / ${IMAGE}:latest -- ${DIGEST}" >&2

if [ "${PUSH}" -eq 1 ]; then
  echo "Pushing ${IMAGE}:${TAG} and ${IMAGE}:latest" >&2
  ${DOCKER} push "${IMAGE}:${TAG}"
  ${DOCKER} push "${IMAGE}:latest"
  PUSHED_DIGEST="$(${DOCKER} inspect --format='{{index .RepoDigests 0}}' "${IMAGE}:latest")"
  echo "Pushed. New :latest digest: ${PUSHED_DIGEST}" >&2
  echo "Record this digest before rolling the deployment -- it is the ONLY" \
       "way back to this exact image once :latest moves again." >&2
  # Machine-parseable line on stdout for docker/deploy.sh (or any other caller) to
  # capture via `grep '^PUSHED_DIGEST='`. Everything else in this script writes to
  # stderr specifically so stdout stays parseable.
  echo "PUSHED_DIGEST=${PUSHED_DIGEST}"
  echo "BUILD_SHA=${BUILD_SHA}"
  echo "BUILD_TIME=${BUILD_TIME}"
else
  echo "Not pushed (pass --push to publish to Docker Hub)." >&2
fi
