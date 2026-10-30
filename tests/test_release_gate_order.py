"""Bootstrap precedes the checks; test steps run in the tests job of ci.yml."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

WORKFLOW = Path(__file__).parents[1] / '.github/workflows/ci.yml'


def job_steps() -> list[tuple[str, str]]:
    workflow = WORKFLOW.read_text(encoding='utf-8')
    tests = workflow.split('\n  tests:\n', 1)[1].split('\n  build:\n', 1)[0]
    blocks = re.split(r'^      - name: ', tests, flags=re.MULTILINE)[1:]
    return [tuple(block.split('\n', 1)) for block in blocks]


class CiTestsJobTests(unittest.TestCase):
    def test_bootstrap_precedes_checks_and_scope_precedes_tests(self) -> None:
        names = [name for name, _ in job_steps()]
        bootstrap = next(
            i for i, name in enumerate(names) if name.startswith('Bootstrap')
        )
        lint = names.index('Type check and full lint (manual-stage hooks, always full)')
        scope = names.index('Resolve pull-request Python test scope')
        tests = names.index('Python test suite -- pull request fast subset')
        self.assertLess(bootstrap, lint)
        self.assertLess(scope, tests)

    def test_uv_cache_uses_a_repository_scoped_runner_temp_path(self) -> None:
        setup = dict(job_steps())['Set up uv']
        cache = re.search(r'^          cache-local-path: (.+)$', setup, re.MULTILINE)
        self.assertIsNotNone(cache)
        assert cache is not None
        self.assertEqual(cache.group(1), '${{ runner.temp }}/overstory/uv-cache')
        self.assertNotIn('enable-cache:', setup)
        self.assertNotIn('UV_LINK_MODE', WORKFLOW.read_text(encoding='utf-8'))

    def test_full_lint_and_typecheck_are_unconditional_and_full(self) -> None:
        body = dict(job_steps())[
            'Type check and full lint (manual-stage hooks, always full)'
        ]
        self.assertNotIn('continue-on-error:', body)
        self.assertNotIn('if:', body)
        self.assertEqual(body.count('--all-files'), 2)

    def test_main_runs_the_full_suite_and_pr_runs_the_subset(self) -> None:
        steps = dict(job_steps())
        self.assertIn(
            "if: github.event_name != 'pull_request'",
            steps['Full test suite (push to main / workflow_dispatch)'],
        )
        for name in (
            'Python test suite -- pull request fast subset',
            'TypeScript test suite -- pull request fast subset (vitest related)',
        ):
            with self.subTest(step=name):
                self.assertIn("if: github.event_name == 'pull_request'", steps[name])


if __name__ == '__main__':
    unittest.main()
