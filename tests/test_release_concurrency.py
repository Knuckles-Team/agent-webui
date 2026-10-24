"""Pull-request checks supersede stale runs; release runs are never cancelled."""

from __future__ import annotations

import unittest
from pathlib import Path

WORKFLOWS = Path(__file__).parents[1] / '.github/workflows'
CI = (WORKFLOWS / 'ci.yml').read_text(encoding='utf-8')
RELEASE = (WORKFLOWS / 'release.yml').read_text(encoding='utf-8')


class CiConcurrencyTests(unittest.TestCase):
    def test_ci_cancels_stale_pull_request_and_main_runs(self) -> None:
        self.assertIn('  cancel-in-progress: true', CI)
        self.assertIn("format('pr-{0}-{1}'", CI)
        self.assertIn("format('main-{0}'", CI)

    def test_release_is_tag_or_dispatch_only_and_never_cancelled(self) -> None:
        self.assertIn("    tags:\n      - 'v*'\n  workflow_dispatch:", RELEASE)
        self.assertNotIn('pull_request', RELEASE)
        self.assertNotIn('branches:', RELEASE)
        self.assertIn('  cancel-in-progress: false', RELEASE)
        self.assertIn(
            '  group: release-${{ github.workflow }}-${{ github.ref }}', RELEASE
        )

    def test_release_publishes_only_to_pypi(self) -> None:
        # spec: WEBUI-APPS-R039
        self.assertIn('publish-pypi:', RELEASE)
        self.assertNotIn('publish-docker', RELEASE)
        self.assertNotIn('docker/', RELEASE)

    def test_ci_never_publishes(self) -> None:
        for marker in ('twine', 'docker/build-push-action', 'create-version-release'):
            self.assertNotIn(marker, CI)

    def test_ci_uses_the_shared_gates_workflow_at_main(self) -> None:
        self.assertIn(
            'uses: Knuckles-Team/pipelines/.github/workflows/gates_pipeline.yml@main',
            CI,
        )
        self.assertIn(
            "timeout-minutes: ${{ github.event_name == 'pull_request' && 15 || 60 }}",
            CI,
        )


if __name__ == '__main__':
    unittest.main()
