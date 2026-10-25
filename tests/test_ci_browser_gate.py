"""Browser qualification stays independent but cannot bypass the final gate."""

from __future__ import annotations

import itertools
import subprocess
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


class BrowserGateTests(unittest.TestCase):
    def setUp(self):
        self.jobs = yaml.safe_load((ROOT / '.github/workflows/ci.yml').read_text())[
            'jobs'
        ]

    def test_independent_journeys_require_successful_setup(self):
        steps = self.jobs['workspace-browser']['steps']
        journeys = [
            step
            for step in steps
            if step.get('id')
            in {
                'liquid_glass_preview',
                'workspace_identity',
                'workspace_catalog',
                'canopy_native',
                'native_zoom',
                'documentation_contract',
                'documentation_capture',
                'execution_graph',
            }
        ]
        self.assertEqual(len(journeys), 8)
        for step in journeys:
            self.assertEqual(
                step['if'],
                "${{ !cancelled() && steps.browser_dependencies.outcome == 'success' "
                "&& steps.browser_engine.outcome == 'success' }}",
            )
            self.assertNotIn('continue-on-error', step)

    def test_native_feature_lenses_run_in_the_required_hosted_selection(self):
        # Source selection only; this assertion is not rendered browser acceptance.
        steps = self.jobs['workspace-browser']['steps']
        native = next(step for step in steps if step.get('id') == 'canopy_native')
        self.assertEqual(
            native['run'],
            'pnpm exec playwright test --config e2e/canopy-glass.config.ts '
            "--grep-invert 'Liquid Glass reference preview'",
        )
        preview = next(step for step in steps if step.get('id') == 'liquid_glass_preview')
        self.assertEqual(
            preview['run'],
            'LIQUID_GLASS_PREVIEW=1 pnpm exec playwright test '
            "--config e2e/canopy-glass.config.ts --grep 'Liquid Glass reference preview' "
            '--output test-results/liquid-glass-preview',
        )
        config = (ROOT / 'e2e/canopy-glass.config.ts').read_text()
        for suite in (
            'explore-graph.browser.ts',
            'work-workflows.browser.ts',
            'operate-usage.browser.ts',
        ):
            self.assertIn(repr(suite), config)
            self.assertTrue((ROOT / 'e2e' / suite).is_file())
        artifact = next(
            step for step in steps
            if step.get('with', {}).get('name') == 'canopy-glass-browser'
        )
        self.assertIn('failure', artifact['if'])
        self.assertEqual(artifact['with']['path'], 'test-results/canopy-glass/')

    def test_aggregate_waits_for_all_required_jobs_even_on_failure(self):
        gate = self.jobs['gates']
        self.assertEqual(gate['if'], 'always()')
        self.assertEqual(gate['needs'], ['hooks', 'tests', 'workspace-browser'])

    def test_actual_gate_script_rejects_failed_cancelled_and_unexpected_skips(self):
        script = self.jobs['gates']['steps'][0]['run']
        states = ('success', 'failure', 'skipped', 'cancelled')
        events = ('pull_request', 'workflow_dispatch', 'push', 'unexpected')
        for event, hooks, tests, browser in itertools.product(events, *([states] * 3)):
            with self.subTest(event=event, hooks=hooks, tests=tests, browser=browser):
                result = subprocess.run(
                    ['/bin/bash', '-c', script],
                    env={'EVENT': event, 'HOOKS': hooks, 'TESTS': tests, 'BROWSER': browser},
                    capture_output=True,
                    check=False,
                )
                expected = (
                    hooks == tests == 'success'
                    and (
                        event in ('pull_request', 'workflow_dispatch')
                        and browser == 'success'
                        or event == 'push'
                        and browser == 'skipped'
                    )
                )
                self.assertEqual(result.returncode == 0, expected, result.stderr)


if __name__ == '__main__':
    unittest.main()
