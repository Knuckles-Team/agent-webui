"""Only pull-request runs supersede an in-progress release check."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

WORKFLOW = Path(__file__).parents[1] / '.github/workflows/release.yml'


def cancellation_for_event(event: str) -> bool:
    """Interpret only the literal or event equality used by this contract."""
    workflow = WORKFLOW.read_text(encoding='utf-8')
    group = workflow.split('\nconcurrency:\n', 1)[1].split('\npermissions:', 1)[0]
    policy = re.search(r'^  cancel-in-progress: (.+)$', group, re.MULTILINE)
    assert policy is not None
    expression = policy.group(1)
    if expression in ('true', 'false'):
        return expression == 'true'
    match = re.fullmatch(r"\$\{\{ github\.event_name == '([a-z_]+)' \}\}", expression)
    assert match is not None, f'Unexpected cancellation expression: {expression}'
    return event == match.group(1)


class ReleaseConcurrencyTests(unittest.TestCase):
    def test_pull_request_supersedes_stale_gate(self) -> None:
        self.assertTrue(cancellation_for_event('pull_request'))

    def test_main_tag_and_manual_runs_are_not_cancelled(self) -> None:
        for event, ref in (
            ('push', 'refs/heads/main'),
            ('push', 'refs/tags/v1.2.3'),
            ('workflow_dispatch', 'refs/heads/main'),
            ('release', 'refs/tags/v1.2.3'),
        ):
            with self.subTest(event=event, ref=ref):
                self.assertFalse(cancellation_for_event(event))

    def test_cancellation_remains_scoped_to_workflow_and_ref(self) -> None:
        workflow = WORKFLOW.read_text(encoding='utf-8')
        self.assertIn(
            '  group: release-${{ github.workflow }}-${{ github.ref }}', workflow
        )

    def test_existing_pr_and_release_timeouts_are_preserved(self) -> None:
        workflow = WORKFLOW.read_text(encoding='utf-8')
        self.assertIn(
            "timeout-minutes: ${{ github.event_name == 'pull_request' && 45 || 60 }}",
            workflow,
        )


if __name__ == '__main__':
    unittest.main()
