#!/usr/bin/env python3
"""Run a hook command only when the tools it needs are installed.

A fresh clone has no ``node_modules``, ``.venv`` or optional CLI tools until
``scripts/bootstrap.sh`` runs. A gate that needs one of them must not block a
local commit, and must not be silently green in CI either: when a requirement
is missing this prints ``SKIPPED (<gate>): <reason>`` and exits 0 locally, or
prints ``CANNOT RUN`` and exits 2 when ``CI`` is set.

Usage::

    run_if_available.py --gate NAME --require node_modules/.bin/tsc \\
        --require pnpm -- pnpm exec tsc --noEmit

A ``--require`` value containing ``/`` is a path relative to the repository
root; any other value is a command looked up on ``PATH``.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


def missing_requirements(requirements: list[str]) -> list[str]:
    """The requirements that are not available, in the order given."""

    missing = []
    for requirement in requirements:
        if "/" in requirement:
            available = (REPOSITORY_ROOT / requirement).exists()
        else:
            available = shutil.which(requirement) is not None
        if not available:
            missing.append(requirement)
    return missing


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--gate", required=True)
    parser.add_argument("--require", action="append", default=[])
    parser.add_argument("command", nargs=argparse.REMAINDER)
    options = parser.parse_args(argv)
    command = options.command[1:] if options.command[:1] == ["--"] else options.command
    if not command:
        parser.error("no command given")

    missing = missing_requirements(options.require)
    if missing:
        reason = f"missing {', '.join(missing)}"
        if os.environ.get("CI"):
            print(f"{options.gate}: CANNOT RUN in CI: {reason}", file=sys.stderr)
            return 2
        print(f"SKIPPED ({options.gate}): {reason}; run scripts/bootstrap.sh")
        return 0
    return subprocess.run(command, cwd=REPOSITORY_ROOT, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())
