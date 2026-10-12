"""Hook setup is shared; runtime tests precede required pre-push gates."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

WORKFLOW = Path(__file__).parents[1] / '.github/workflows/release.yml'


def gate_steps() -> list[tuple[str, str]]:
    workflow = WORKFLOW.read_text(encoding='utf-8')
    gates = workflow.split('\n  gates:\n', 1)[1].split(
        '\n  # Spec-status lifecycle', 1
    )[0]
    blocks = re.split(r'^      - name: ', gates, flags=re.MULTILINE)[1:]
    return [tuple(block.split('\n', 1)) for block in blocks]


class ReleaseGateOrderTests(unittest.TestCase):
    def test_bootstrap_commit_hooks_and_scope_precede_tests(self) -> None:
        names = [name for name, _ in gate_steps()]
        bootstrap = next(
            i for i, name in enumerate(names) if name.startswith('Bootstrap')
        )
        commit = names.index('pre-commit (commit stage, all files)')
        scope = names.index('Resolve pull-request Python test scope')
        tests = names.index('Python test suite -- pull request fast subset')
        self.assertLess(bootstrap, commit)
        self.assertLess(commit, scope)
        self.assertLess(scope, tests)

    def test_cold_hook_setup_precedes_bounded_validation(self) -> None:
        steps = gate_steps()
        names = [name for name, _ in steps]
        prepare = names.index('Prepare shared hook environments')
        bootstrap = next(
            i for i, name in enumerate(names) if name.startswith('Bootstrap')
        )
        commit = names.index('pre-commit (commit stage, all files)')
        self.assertLess(bootstrap, prepare)
        self.assertLess(prepare, commit)
        setup = steps[prepare][1]
        self.assertIn(
            'run: uvx pre-commit install-hooks --config .config/pre-commit.yaml',
            setup,
        )
        for body in (setup, steps[commit][1]):
            self.assertIn('timeout-minutes: 15', body)
            self.assertNotIn('continue-on-error:', body)
            self.assertNotIn('if:', body)

    def test_all_hook_stages_share_a_fresh_cache_per_attempt(self) -> None:
        workflow = WORKFLOW.read_text(encoding='utf-8')
        gates = workflow.split('\n  gates:\n', 1)[1].split(
            '\n  # Spec-status lifecycle', 1
        )[0]
        job, steps = gates.split('    steps:\n', 1)
        self.assertIn(
            '    env:\n'
            '      PRE_COMMIT_HOME: ${{ runner.temp }}/pre-commit-'
            '${{ github.run_id }}-${{ github.run_attempt }}',
            job,
        )
        self.assertNotIn('PRE_COMMIT_HOME', steps)
        self.assertNotIn('SKIP:', job + steps)
        runs = [
            line.strip()
            for line in steps.splitlines()
            if 'uvx pre-commit run ' in line
        ]
        self.assertEqual(len(runs), 4)
        for command in runs:
            self.assertIn('--all-files', command)
            self.assertNotIn('||', command)

    def test_existing_runtime_test_steps_precede_pre_push(self) -> None:
        names = [name for name, _ in gate_steps()]
        pre_push = names.index('pre-commit (pre-push stage, all files)')
        for name in (
            'Full test suite (push to main / workflow_dispatch)',
            'Python test suite -- pull request fast subset',
            'TypeScript test suite -- pull request fast subset (vitest related)',
        ):
            with self.subTest(step=name):
                self.assertLess(names.index(name), pre_push)

    def test_pre_push_command_remains_single_unconditional_failure_gate(self) -> None:
        steps = [
            body
            for name, body in gate_steps()
            if name == 'pre-commit (pre-push stage, all files)'
        ]
        self.assertEqual(len(steps), 1)
        self.assertEqual(
            steps[0].strip(),
            'run: uvx pre-commit run --config .config/pre-commit.yaml --all-files '
            '--hook-stage pre-push --show-diff-on-failure',
        )


if __name__ == '__main__':
    unittest.main()
