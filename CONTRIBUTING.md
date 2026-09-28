# Contributing to agent-webui

`AGENTS.md` is the full engineering contract; this page is the short path from
a fresh clone to a pull request.

## Set up

Requirements: git, Python 3, Node.js (see `.node-version`) with `pnpm` or
`corepack`. Then, from the repository root:

```bash
scripts/bootstrap.sh
```

The script is idempotent. It checks out the sibling sources pinned in
`scripts/siblings.lock` under `.uv-workspace-siblings/`, installs uv 0.9 or
newer when needed, installs the pinned Python, runs `uv sync --frozen` with the
test extra, installs frontend dependencies with `pnpm install --frozen-lockfile`,
and installs the pre-commit and pre-push hooks from `.config/pre-commit.yaml`.
Pass `--engine` to also build the epistemic-graph engine from source, which the
knowledge-graph tests need. Claude Code cloud sessions run the same script
through `.claude/hooks/session-start.sh`.

## Check your change

```bash
uv run --no-sync pytest tests
pnpm test
uvx pre-commit run --config .config/pre-commit.yaml --all-files
```

CI runs that same pre-commit file, so a clean local run predicts the CI
result. A hook that cannot find its tool prints `SKIPPED (<gate>): <reason>`
locally; run `scripts/bootstrap.sh` to enable it. In CI the same condition
fails the job.

## Branches and pull requests

1. Create a topic branch from `main`.
2. Commit in small, logical steps with conventional commit subjects
   (`fix(scope): ...`, `feat(scope): ...`). Stage explicit paths and review
   `git diff --cached` first.
3. Push with `git push -u origin <branch>` and open a pull request against
   `main`, as a draft until it is ready for review.
4. The `gates` job must pass. Never bypass hooks with `--no-verify` or `SKIP`.
