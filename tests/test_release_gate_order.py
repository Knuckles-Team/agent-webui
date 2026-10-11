"""Runtime test evidence precedes the still-required pre-push metadata gates."""

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
