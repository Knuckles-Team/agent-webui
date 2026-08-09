"""Chokepoint gate: no production caller of ``create_agent_web_app`` may
construct ``workspace_helpers`` empty (GOC-60-W04b acceptance gate 4).

CONCEPT:AU-ECO.mcp.webui-governed-mcp-delegation

GOC-60 lane evidence E2 (break 2): ``agent/agent_webui/server.py``'s
standalone CLI entrypoint (``main()``) called
``create_agent_web_app(agent, workspace_helpers={}, listener_host=host)`` --
a LITERAL empty dict. All three MCP delegation routes resolve behaviour via
``get_helper(...)`` against that dict, so each answered 501 unconditionally
in that topology -- regardless of whether the OTHER caller of
``create_agent_web_app`` (``agent_utilities/server/app.py``'s embedded mount
path) was ever fixed. That is exactly the "control wired at one entrypoint
while other callers bypass it" failure mode this codebase has repeatedly
hit (see workspace ``CLAUDE.md``'s "Enforce at the chokepoint, not one
entrypoint" note).

A gate that only checks ONE call site (e.g. only ``server.py:1889``) would
miss the NEXT caller that makes the same mistake. So this gate is wired at
the CHOKEPOINT: it statically scans every non-test ``.py`` file in this
repository for a call to ``create_agent_web_app`` and fails if ANY of them
passes a literal empty dict for ``workspace_helpers`` -- not merely the one
call site this lane happened to fix.
"""

from __future__ import annotations

import ast
import subprocess
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]  # .../agent-webui


def find_empty_workspace_helpers_calls(source: str, filename: str) -> list[str]:
    """Return one ``"<filename>:<lineno>"`` entry per ``create_agent_web_app``
    call in ``source`` whose ``workspace_helpers`` argument (keyword OR 2nd
    positional) is a literal empty dict.

    Pure static analysis -- no import, no execution -- so it is safe to run
    over arbitrary repository source, including files with heavy runtime
    dependencies this test process does not want to import.
    """
    try:
        tree = ast.parse(source, filename=filename)
    except SyntaxError:
        return []

    violations: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        name = func.id if isinstance(func, ast.Name) else getattr(func, 'attr', None)
        if name != 'create_agent_web_app':
            continue

        helpers_arg: ast.expr | None = None
        for kw in node.keywords:
            if kw.arg == 'workspace_helpers':
                helpers_arg = kw.value
                break
        if helpers_arg is None and len(node.args) >= 2:
            helpers_arg = node.args[1]

        if helpers_arg is None:
            continue  # cannot tell statically -- not this gate's job to guess
        if isinstance(helpers_arg, ast.Dict) and not helpers_arg.keys:
            violations.append(f'{filename}:{node.lineno}')
    return violations


def _is_test_path(path: Path) -> bool:
    """Isolated, intentional negative-path unit tests (e.g. the
    ``unwired_client`` fixtures in ``test_mcp_delegation_routes.py`` that
    deliberately pass ``{}`` to prove the 501 refusal) are SUPPOSED to
    construct an empty dict -- those are not the production paths this gate
    exists to protect.
    """
    parts = path.parts
    if '__tests__' in parts or 'tests' in parts or 'test' in parts:
        return True
    return path.name.startswith('test_') or path.name.endswith('_test.py')


def _tracked_python_files() -> list[Path]:
    """Every ``.py`` file git actually tracks in this repository.

    Deliberately ``git ls-files`` rather than ``Path.rglob`` -- a filesystem
    walk also picks up generated, gitignored build output (``build/lib/...``
    from a packaging step, ``node_modules``, ``.venv``, coverage caches, ...),
    which can contain a STALE COPY of a since-fixed source file and would
    falsely re-flag an already-fixed call site as a live production
    violation. A chokepoint gate protecting production source should only
    ever look at tracked source, matching what actually ships/reviews.
    """
    result = subprocess.run(
        ['git', 'ls-files', '--', '*.py'],
        cwd=_REPO_ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return [_REPO_ROOT / line for line in result.stdout.splitlines() if line]


def _production_violations() -> list[str]:
    violations: list[str] = []
    for path in _tracked_python_files():
        if _is_test_path(path):
            continue
        if not path.is_file():
            continue  # a tracked path git still lists after a local deletion
        source = path.read_text(encoding='utf-8', errors='ignore')
        if 'create_agent_web_app' not in source:
            continue
        violations.extend(
            find_empty_workspace_helpers_calls(
                source, str(path.relative_to(_REPO_ROOT))
            )
        )
    return violations


def test_the_scanner_flags_a_known_bad_literal_empty_dict_call() -> None:
    """Prove the gate actually catches something, using a synthetic snippet
    that reproduces EXACTLY the shape of the original defect at
    ``server.py:1889``
    (``create_agent_web_app(agent, workspace_helpers={}, listener_host=host)``).
    """
    bad_source = (
        'def main():\n'
        '    app = create_agent_web_app(agent, workspace_helpers={}, listener_host=host)\n'
    )
    violations = find_empty_workspace_helpers_calls(bad_source, 'synthetic_bad.py')
    assert violations == ['synthetic_bad.py:2']


def test_the_scanner_flags_a_known_bad_positional_empty_dict_call() -> None:
    """Same defect shape, but with ``workspace_helpers`` passed positionally
    (as several existing test fixtures do, e.g.
    ``create_agent_web_app(mock_agent, {})``) -- the gate must catch that
    shape too, not only the keyword form.
    """
    bad_source = 'app = create_agent_web_app(agent, {})\n'
    violations = find_empty_workspace_helpers_calls(bad_source, 'synthetic_bad2.py')
    assert violations == ['synthetic_bad2.py:1']


def test_the_scanner_does_not_flag_a_populated_call() -> None:
    """Negative control: a populated dict literal, or a variable/call whose
    contents cannot be determined statically, must NOT be flagged."""
    good_source = (
        'def main():\n'
        '    app = create_agent_web_app(agent, workspace_helpers=some_dict, '
        'listener_host=host)\n'
    )
    assert find_empty_workspace_helpers_calls(good_source, 'synthetic_good.py') == []

    also_good = "app = create_agent_web_app(agent, workspace_helpers={'x': 1})\n"
    assert find_empty_workspace_helpers_calls(also_good, 'synthetic_good2.py') == []

    helper_call = (
        'app = create_agent_web_app(agent, workspace_helpers=build_helpers())\n'
    )
    assert find_empty_workspace_helpers_calls(helper_call, 'synthetic_good3.py') == []


def test_no_production_caller_of_create_agent_web_app_constructs_workspace_helpers_empty() -> (
    None
):
    """The chokepoint: every non-test ``.py`` file in this repository is
    scanned for ``create_agent_web_app(...)`` calls, not just
    ``server.py``'s known caller -- so a FUTURE second production caller
    that makes the same mistake is caught too, not only the one call site
    this lane fixed.

    RED before the GOC-60-W04b fix: flags
    ``agent/agent_webui/server.py:1889``. GREEN after.
    """
    violations = _production_violations()
    assert violations == [], (
        'production caller(s) of create_agent_web_app construct '
        f'workspace_helpers as a literal empty dict: {violations}'
    )
