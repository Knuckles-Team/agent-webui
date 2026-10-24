"""Hooks skip visibly locally and fail closed in CI when they cannot run."""

from __future__ import annotations

import importlib.util
import json
import sys
import unittest
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


class DesignAcceptanceLedgerTests(unittest.TestCase):
    """Guard metadata scope, not acceptance of the features named by its rows."""

    def rows(self, spec):
        data = json.loads(
            (SCRIPTS.parent / 'specs' / spec / 'status.json').read_text()
        )
        self.assertEqual(data['delivery_state'], 'SPECIFIED')
        return {row['id']: row for row in data['requirements']}

    def test_design_ancestors_keep_retained_acceptance_open(self):
        rows = self.rows('browser-design-system')
        prefix = 'WEBUI-' + 'DESIGN-'
        for number in ('R002', 'R002.1', 'R004', 'R004.1', 'R004.2', 'R010'):
            with self.subTest(number=number):
                self.assertEqual(rows[prefix + number]['delivery_state'], 'SPECIFIED')
        for parent, child in (
            ('R002', 'R002.1'),
            ('R002.1', 'R002.1.2'),
            ('R004', 'R004.1'),
            ('R004.1', 'R004.1.2'),
            ('R004', 'R004.2'),
            ('R004.2', 'R004.2.2'),
        ):
            self.assertIn(prefix + child, rows[prefix + parent]['rollup_of'])
        for number in ('R002.1.2', 'R004.1.2', 'R004.2.2'):
            with self.subTest(number=number):
                row = rows[prefix + number]
                self.assertEqual(row['delivery_state'], 'SPECIFIED')
                self.assertEqual(row['landed_in'], [])
                self.assertEqual(row['verified_by'], [])

    def test_measured_redesign_ancestors_keep_acceptance_open(self):
        rows = self.rows('arbora-app-surface')
        prefix = 'WEBUI-' + 'APPS-'
        for number in ('R049', 'R049.2', 'R049.2.2'):
            with self.subTest(number=number):
                self.assertEqual(rows[prefix + number]['delivery_state'], 'SPECIFIED')
        for parent, child in (('R049', 'R049.2'), ('R049.2', 'R049.2.2')):
            self.assertIn(prefix + child, rows[prefix + parent]['rollup_of'])
        remainder = rows[prefix + 'R049.2.2']
        self.assertEqual(remainder['landed_in'], [])
        self.assertEqual(remainder['verified_by'], [])

    def test_qualified_source_children_keep_their_delivery_evidence(self):
        for spec, owner, numbers in (
            ('browser-design-system', 'DESIGN', ('R002.1.1', 'R004.1.1', 'R005.2')),
            ('arbora-app-surface', 'APPS', ('R049.2.1',)),
        ):
            rows = self.rows(spec)
            for number in numbers:
                with self.subTest(owner=owner, number=number):
                    row = rows[f'WEBUI-{owner}-{number}']
                    self.assertEqual(row['delivery_state'], 'VERIFIED')
                    self.assertTrue(row['landed_in'])
                    self.assertTrue(row['verified_by'])

    def test_native_chat_keeps_broader_authority_acceptance_open(self):
        rows = self.rows('arbora-app-surface')
        prefix = 'WEBUI-' + 'APPS-'
        for number in ('R047', 'R048', 'R049.1.2', 'R050'):
            with self.subTest(number=number):
                self.assertEqual(rows[prefix + number]['delivery_state'], 'SPECIFIED')
