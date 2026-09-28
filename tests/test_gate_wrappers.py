"""Hooks skip visibly locally and fail closed in CI when they cannot run."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

import pytest

SCRIPTS = Path(__file__).parents[1] / 'scripts'


def _load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f'{name}.py')
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(('ci', 'expected'), [(None, 0), ('true', 2)])
def test_missing_tool_skips_locally_and_fails_in_ci(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    ci: str | None,
    expected: int,
) -> None:
    gate = _load('run_if_available')
    monkeypatch.delenv('CI', raising=False)
    if ci:
        monkeypatch.setenv('CI', ci)
    code = gate.main(['--gate', 'demo', '--require', 'no/such/tool', '--', 'true'])
    assert code == expected
    out = capsys.readouterr()
    if expected == 0:
        assert out.out.startswith('SKIPPED (demo): ')
    else:
        assert 'CANNOT RUN' in out.err


def test_available_tool_runs_the_command_and_keeps_its_status() -> None:
    gate = _load('run_if_available')
    assert gate.main(['--gate', 'demo', '--require', 'python3', '--', 'false']) == 1


@pytest.mark.parametrize(('ci', 'expected'), [(None, 0), ('true', 2)])
def test_missing_agent_utilities_skips_locally_and_fails_in_ci(
    monkeypatch: pytest.MonkeyPatch, ci: str | None, expected: int
) -> None:
    gate = _load('run_agent_utilities_gate')
    monkeypatch.setattr(gate, 'resolve', lambda workspace_only: None)
    monkeypatch.delenv('CI', raising=False)
    monkeypatch.delenv('CLAUDE_CODE_REMOTE', raising=False)
    if ci:
        monkeypatch.setenv('CI', ci)
    assert gate.main(['--gate', 'demo', '--script', 'scripts/x.py']) == expected


def test_workspace_policy_gate_never_fails_without_a_workspace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gate = _load('run_agent_utilities_gate')
    monkeypatch.setattr(gate, 'resolve', lambda workspace_only: None)
    monkeypatch.setenv('CI', 'true')
    args = ['--gate', 'lane', '--workspace-only', '--script', 'scripts/x.py']
    assert gate.main(args) == 0
