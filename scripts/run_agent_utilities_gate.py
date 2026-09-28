#!/usr/bin/env python3
"""Run a shared agent-utilities gate script against this checkout.

Several fleet-wide pre-commit gates live in agent-utilities' ``scripts/``
directory. This wrapper resolves that checkout in a fixed order:

1. ``AGENT_UTILITIES_ROOT`` when set;
2. ``.uv-workspace-siblings/agent-utilities`` -- the checkout
   ``scripts/bootstrap.sh`` materializes at the commit pinned in
   ``scripts/siblings.lock``;
3. an ``agent-utilities`` directory beside any ancestor of this checkout
   (a maintainer's multi-repository workspace).

When no checkout is found the gate cannot run: under CI (``CI`` set) it fails
closed with exit status 2; locally it prints ``SKIPPED`` and exits 0.

``--workspace-only`` marks a gate that enforces maintainer-workspace policy
(for example lane-guard's canonical-checkout rule). It runs only when the
checkout is found through (1) or (3), never in a Claude Code cloud session,
and is otherwise skipped with a notice, including in CI, because the policy
has no meaning in a single fresh clone.

Usage: ``run_agent_utilities_gate.py --gate NAME --script scripts/x.py [-- args]``
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
PINNED_SIBLING = REPOSITORY_ROOT / ".uv-workspace-siblings" / "agent-utilities"


def _is_agent_utilities_root(path: Path) -> bool:
    return (path / "pyproject.toml").is_file() and (path / "scripts").is_dir()


def _workspace_root() -> Path | None:
    configured = os.environ.get("AGENT_UTILITIES_ROOT", "").strip()
    if configured:
        root = Path(configured).expanduser().resolve()
        if not _is_agent_utilities_root(root):
            raise SystemExit(
                f"AGENT_UTILITIES_ROOT={configured!r} is not an agent-utilities checkout"
            )
        return root
    for ancestor in REPOSITORY_ROOT.parents:
        candidate = ancestor / "agent-utilities"
        if candidate.resolve() != REPOSITORY_ROOT and _is_agent_utilities_root(
            candidate
        ):
            return candidate.resolve()
    return None


def resolve(workspace_only: bool) -> Path | None:
    """The agent-utilities checkout to run gates from, or ``None``."""

    if not workspace_only and not os.environ.get("AGENT_UTILITIES_ROOT", "").strip():
        if _is_agent_utilities_root(PINNED_SIBLING):
            return PINNED_SIBLING.resolve()
    return _workspace_root()


def unavailable(gate: str, reason: str) -> int:
    """Fail closed in CI; skip visibly everywhere else."""

    if os.environ.get("CI"):
        print(f"{gate}: CANNOT RUN in CI: {reason}", file=sys.stderr)
        return 2
    print(f"SKIPPED ({gate}): {reason}; run scripts/bootstrap.sh")
    return 0


def _python() -> str:
    """This checkout's synced interpreter when present, else the caller's."""

    venv_python = REPOSITORY_ROOT / ".venv" / "bin" / "python"
    return str(venv_python) if venv_python.is_file() else sys.executable


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--gate", required=True, help="name printed in notices")
    parser.add_argument("--script", required=True, help="path inside agent-utilities")
    parser.add_argument("--workspace-only", action="store_true")
    parser.add_argument("arguments", nargs=argparse.REMAINDER)
    options = parser.parse_args(argv)

    if options.workspace_only and os.environ.get("CLAUDE_CODE_REMOTE") == "true":
        print(f"SKIPPED ({options.gate}): maintainer-workspace policy; cloud session")
        return 0
    root = resolve(options.workspace_only)
    if root is None:
        if options.workspace_only:
            print(
                f"SKIPPED ({options.gate}): maintainer-workspace policy; no "
                "agent-utilities workspace sibling or AGENT_UTILITIES_ROOT found"
            )
            return 0
        return unavailable(options.gate, "agent-utilities checkout not found")

    script = root / options.script
    if not script.is_file():
        return unavailable(options.gate, f"{options.script} missing in {root}")
    arguments = options.arguments
    if arguments[:1] == ["--"]:
        arguments = arguments[1:]
    result = subprocess.run(
        [_python(), str(script), *arguments],
        cwd=REPOSITORY_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    sys.stdout.write(result.stdout)
    if result.returncode and "ModuleNotFoundError" in result.stderr:
        missing = result.stderr.strip().splitlines()[-1]
        return unavailable(options.gate, f"environment incomplete ({missing})")
    sys.stderr.write(result.stderr)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
