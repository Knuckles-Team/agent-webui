#!/usr/bin/env bash
# One-command setup for an agent-webui checkout (local or Claude Code cloud).
#
# From a fresh clone with git, python3 and node available this:
#   1. checks out the pinned `.uv-workspace-siblings/` sources listed in
#      scripts/siblings.lock (uv.lock references them as editable paths);
#   2. ensures uv >= 0.9 (older releases cannot fetch new CPython patch
#      releases), installs the pinned Python and syncs the locked environment
#      (`.venv`) with the test extra;
#   3. installs the frontend dependencies from pnpm-lock.yaml;
#   4. installs the pre-commit and pre-push git hooks from .config/pre-commit.yaml.
#
# epistemic-graph (a native Rust engine with no satisfying PyPI release) is not
# built by default; tests that import agent_utilities' knowledge-graph or
# numeric layers need it and error at collection without it. Pass --engine to
# build it from the pinned source (Rust + maturin; tens of minutes cold).
#
# Idempotent and non-interactive. Afterwards run every commit-stage gate with:
#   uvx pre-commit run --config .config/pre-commit.yaml --all-files
#
# Usage: scripts/bootstrap.sh [--siblings-only] [--engine] [--no-frontend] [--no-hooks]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SIBLINGS_ONLY=0
ENGINE=0
FRONTEND=1
HOOKS=1
for arg in "$@"; do
  case "$arg" in
    --siblings-only) SIBLINGS_ONLY=1 ;;
    --engine) ENGINE=1 ;;
    --no-frontend) FRONTEND=0 ;;
    --no-hooks) HOOKS=0 ;;
    -h | --help)
      sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d; s/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "bootstrap: unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

log() { printf '[bootstrap] %s\n' "$*" >&2; }

# ── 1. pinned sibling sources ───────────────────────────────────────────────
# A symlink (a maintainer's multi-repository workspace) is respected as-is.
checkout_sibling() {
  local dest="$1" url="$2" commit="$3"
  if [ -L "$dest" ]; then
    log "$dest is a workspace symlink; leaving it untouched"
    return 0
  fi
  if [ -d "$dest/.git" ] && [ "$(git -C "$dest" rev-parse HEAD 2>/dev/null)" = "$commit" ]; then
    log "$dest already at ${commit:0:12}"
    return 0
  fi
  if [ -e "$dest" ] && [ ! -d "$dest/.git" ]; then
    echo "bootstrap: $dest exists but is not a git checkout; remove it and re-run" >&2
    exit 1
  fi
  log "$dest: checking out ${commit:0:12} from $url"
  mkdir -p "$dest"
  git -C "$dest" init -q
  git -C "$dest" remote remove origin 2>/dev/null || true
  git -C "$dest" remote add origin "$url"
  local attempt
  for attempt in 1 2 3 4; do
    if git -C "$dest" fetch -q --depth 1 origin "$commit"; then
      break
    fi
    if [ "$attempt" -eq 4 ]; then
      echo "bootstrap: could not fetch $url@$commit" >&2
      exit 1
    fi
    sleep $((2 ** attempt))
  done
  git -C "$dest" -c advice.detachedHead=false checkout -q --force FETCH_HEAD
  test "$(git -C "$dest" rev-parse HEAD)" = "$commit"
}

while read -r dest url commit _when; do
  case "$dest" in '' | '#'*) continue ;; esac
  checkout_sibling "$dest" "$url" "$commit"
done <scripts/siblings.lock

if [ "$SIBLINGS_ONLY" -eq 1 ]; then
  exit 0
fi

# ── 2. uv, Python, locked environment ───────────────────────────────────────
export PATH="$HOME/.local/bin:$PATH"
uv_is_current() {
  command -v uv >/dev/null 2>&1 || return 1
  local version major minor
  version="$(uv --version | awk '{print $2}')"
  major="${version%%.*}"
  minor="${version#*.}"
  minor="${minor%%.*}"
  [ "$major" -gt 0 ] || [ "$minor" -ge 9 ]
}
if ! uv_is_current; then
  log "uv >= 0.9 not found; installing it"
  python3 -m pip install --user --quiet --upgrade "uv>=0.9" 2>/dev/null ||
    python3 -m pip install --user --quiet --upgrade --break-system-packages "uv>=0.9" 2>/dev/null ||
    curl -LsSf https://astral.sh/uv/install.sh | sh
  hash -r
  uv_is_current || {
    echo "bootstrap: uv >= 0.9 is required (https://docs.astral.sh/uv/)" >&2
    exit 1
  }
fi
log "$(uv --version)"

# The interpreter floor of `requires-python` is the version the suite runs on.
PYTHON_VERSION="$(sed -n 's/^requires-python *= *">=\([0-9]*\.[0-9]*\).*/\1/p' pyproject.toml)"
: "${PYTHON_VERSION:?could not read requires-python from pyproject.toml}"
uv python install "$PYTHON_VERSION"

SYNC=(uv sync --frozen --python "$PYTHON_VERSION" --extra test)
if [ "$ENGINE" -eq 1 ]; then
  log "building epistemic-graph from source; this is the slow step"
else
  SYNC+=(--no-install-package epistemic-graph)
fi
log "${SYNC[*]}"
"${SYNC[@]}"

# ── 3. frontend dependencies (from the lockfile only) ───────────────────────
if [ "$FRONTEND" -eq 1 ] && [ -f pnpm-lock.yaml ]; then
  if ! command -v pnpm >/dev/null 2>&1 && command -v corepack >/dev/null 2>&1; then
    corepack enable pnpm 2>/dev/null || true
  fi
  if command -v pnpm >/dev/null 2>&1; then
    log "pnpm install --frozen-lockfile"
    pnpm install --frozen-lockfile
  else
    log "pnpm not found; skipping frontend dependencies (frontend hooks will report SKIPPED)"
  fi
fi

# ── 4. git hooks ────────────────────────────────────────────────────────────
if [ "$HOOKS" -eq 1 ] && [ -z "${CI:-}" ] && git rev-parse --git-dir >/dev/null 2>&1; then
  if [ -n "$(git config --get core.hooksPath || true)" ]; then
    log "core.hooksPath is set; skipping hook installation (unset it to install)"
  else
    uvx pre-commit install --config .config/pre-commit.yaml \
      --hook-type pre-commit --hook-type pre-push
  fi
fi

log "done. Next:"
log "  gates:  uvx pre-commit run --config .config/pre-commit.yaml --all-files"
log "  tests:  uv run --no-sync pytest -q && pnpm test"
