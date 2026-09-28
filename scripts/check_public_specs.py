"""Validate tracked public owner specifications without network or workspace inputs."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

REQUIRED = ("spec.md", "plan.md", "test-spec.md", "tasks.md")
FORBIDDEN = (
    re.compile(r"plans/", re.IGNORECASE),
    re.compile(r"\bgitlab\b", re.IGNORECASE),
    re.compile(r"\bhomelab\b", re.IGNORECASE),
    re.compile(r"(?:file://|/(?:home|Users|tmp|workspace)/)", re.IGNORECASE),
)
LINK = re.compile(r"(?<!!)\[[^\]]+\]\(([^)]+)\)")
LOCAL_HOST = re.compile(
    r"(?:^localhost$|\.local$|\.internal$|\.lan$|^127\.|^10\.|^192\.168\.)",
    re.IGNORECASE,
)
PLACEHOLDER = re.compile(
    r"\[(?:Describe|Exact|Record|ID|Feature name|repository name|Observable behavior|Measurable)",
    re.IGNORECASE,
)
CONTENT_MARKERS = {
    "spec.md": re.compile(r"requirement|acceptance|\bFR-\d+\b", re.IGNORECASE),
    "plan.md": re.compile(r"architecture|design|interface", re.IGNORECASE),
    "test-spec.md": re.compile(r"test|expected|proof", re.IGNORECASE),
    "tasks.md": re.compile(r"(?m)^- \[[ xX]\]"),
}


def tracked_specs(root: Path) -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "-z", "--", "specs"],
        cwd=root,
        check=True,
        stdout=subprocess.PIPE,
    )
    return [Path(value.decode()) for value in result.stdout.split(b"\0") if value]


def _document_errors(path: Path, content: str) -> list[str]:
    errors = []
    if len(content.strip()) < 250 or content.count("\n## ") < 1:
        errors.append(f"{path}: add substantive, structured design or proof")
    if PLACEHOLDER.search(content):
        errors.append(f"{path}: unresolved template placeholder")
    if not CONTENT_MARKERS[path.name].search(content):
        errors.append(f"{path}: missing required behavior, design, test, or tasks")
    return errors


def _contract_errors(root: Path, paths: set[Path]) -> list[str]:
    errors = []
    names = sorted(
        {
            path.parts[1]
            for path in paths
            if len(path.parts) > 2 and path.parts[1] != "_template"
        }
    )
    for name in names:
        for filename in REQUIRED:
            path = Path("specs") / name / filename
            if path not in paths:
                errors.append(f"{path}: missing required owner contract")
                continue
            errors.extend(
                _document_errors(path, (root / path).read_text(encoding="utf-8"))
            )
    return errors


def _link_error(root: Path, path: Path, target: str) -> str | None:
    target = target.strip().split(" ", 1)[0].strip("<>")
    if target.startswith("#"):
        return None
    parsed = urlsplit(target)
    if parsed.scheme:
        public = parsed.scheme in ("http", "https") and parsed.hostname
        if not public or LOCAL_HOST.search(parsed.hostname):
            return f"{path}: non-public link {target}"
        return None
    if target.startswith("/"):
        return f"{path}: absolute local link {target}"
    candidate = (root / path.parent / unquote(parsed.path)).resolve()
    if not candidate.is_relative_to(root.resolve()) or not candidate.exists():
        return f"{path}: broken relative link {target}"
    return None


def _reference_errors(root: Path, path: Path) -> list[str]:
    content = (root / path).read_text(encoding="utf-8")
    errors = []
    if "_template" not in path.parts:
        errors.extend(
            f"{path}: private or local reference ({pattern.pattern})"
            for pattern in FORBIDDEN
            if pattern.search(content)
        )
    errors.extend(
        issue
        for target in LINK.findall(content)
        if (issue := _link_error(root, path, target))
    )
    return errors


def problems(root: Path) -> list[str]:
    paths = set(tracked_specs(root))
    errors = _contract_errors(root, paths)
    for path in sorted(paths):
        if path.suffix == ".md":
            errors.extend(_reference_errors(root, path))
    return errors


def main() -> int:
    errors = problems(Path(__file__).resolve().parents[1])
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print("Public specs are self-contained and locally linked.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
