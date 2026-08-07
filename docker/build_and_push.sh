#!/usr/bin/env bash
# Repeatable build (and optional push) for the agent-webui runtime image
# (D-WUI-30). Wraps the exact `docker build` invocation documented in the
# Dockerfile header so cutting an image is one command, not the multi-step
# manual process used to reconstruct this pipeline in the first place.
#
# WHY A SCRIPT, NOT A CI PIPELINE: verified (2026-08-06) that no CI job has
# ever built this image -- `.github/workflows/pipeline.yml` only cuts a PyPI
# release, and DockerHub's own metadata shows the live `knucklessg1/
# agent-webui:latest` was pushed once, manually, with no reproducible path
# back to source. The engine image (graph-os-unified, gitlab.arpa project
# 361) IS built by GitLab CI, but that pipeline fetches a PRE-BUILT artifact
# from a generic package registry and bakes it via kaniko -- a different
# shape than this build (which compiles the wheel itself) and, more to the
# point, requires GitLab project access/credentials this lane does not have.
# A documented, repeatable script is the honest match for "how these images
# are made today"; promoting it to a real GitLab CI job (mirroring project
# 361's pattern) is a valid follow-up for whoever holds that access.
#
# WHY TWO EXTRA BUILD CONTEXTS: agent-webui's runtime imports
# agent_utilities.security.persistence_privacy and friends at module load,
# but PyPI's newest agent-utilities (1.26.4) doesn't have that module, and
# agent-utilities' own dependency floor (epistemic-graph[full]>=2.23.2) is
# ahead of PyPI's newest epistemic-graph (2.23.0) too -- see the Dockerfile
# header for the full empirical trail. So the build needs agent-utilities'
# actual source tree (built into a wheel in-image, no Rust required) and a
# pre-built epistemic-graph wheel (the Rust engine; rebuilding it here would
# need a cargo/maturin toolchain this image doesn't carry).
#
# Usage:
#   docker/build_and_push.sh [--push] [--tag TAG]
#
# Env overrides (all optional; defaults match the sibling layout this repo
# is normally checked out in -- see plans/au-eg-program/designs/
# design-remote-build-hosts-2026-08-06.md for the r820 buildhost layout):
#   AU_SRC_PATH       path to an agent-utilities checkout (default: ../agent-utilities)
#   WHEELHOUSE_PATH   directory containing epistemic_graph-*.whl
#                     (default: ../../.dev-wheelhouse, then ~/buildhost-r820
#                     style layouts are NOT auto-detected -- pass explicitly
#                     on a host without the workspace tree, e.g. r820)
#   IMAGE             image name:tag prefix (default: knucklessg1/agent-webui)
#   DOCKER            docker binary to invoke (default: docker; r820 needs
#                     `sudo docker` -- e.g. DOCKER="sudo docker")
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AU_SRC_PATH="${AU_SRC_PATH:-${REPO_ROOT}/../agent-utilities}"
WHEELHOUSE_PATH="${WHEELHOUSE_PATH:-${REPO_ROOT}/../../.dev-wheelhouse}"
IMAGE="${IMAGE:-knucklessg1/agent-webui}"
DOCKER="${DOCKER:-docker}"

PUSH=0
TAG="$(cd "${REPO_ROOT}" && git rev-parse --short HEAD)"
while [ $# -gt 0 ]; do
  case "$1" in
    --push) PUSH=1; shift ;;
    --tag) TAG="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 64 ;;
  esac
done

if [ ! -d "${AU_SRC_PATH}" ]; then
  echo "AU_SRC_PATH does not exist: ${AU_SRC_PATH}" >&2
  echo "set AU_SRC_PATH to an agent-utilities checkout (source, not a wheel)" >&2
  exit 66
fi
if ! ls "${WHEELHOUSE_PATH}"/epistemic_graph-*.whl >/dev/null 2>&1; then
  echo "WHEELHOUSE_PATH has no epistemic_graph-*.whl: ${WHEELHOUSE_PATH}" >&2
  echo "set WHEELHOUSE_PATH to a directory containing a pre-built wheel" \
       "matching agent-utilities' epistemic-graph[full] floor" >&2
  exit 66
fi

echo "Building ${IMAGE}:${TAG} (au-src=${AU_SRC_PATH}, wheelhouse=${WHEELHOUSE_PATH})" >&2
${DOCKER} build -f "${REPO_ROOT}/docker/Dockerfile" \
  --build-context au-src="${AU_SRC_PATH}" \
  --build-context wheelhouse="${WHEELHOUSE_PATH}" \
  -t "${IMAGE}:${TAG}" \
  -t "${IMAGE}:latest" \
  "${REPO_ROOT}"

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
else
  echo "Not pushed (pass --push to publish to Docker Hub)." >&2
fi
