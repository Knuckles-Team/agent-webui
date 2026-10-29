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
        gate = self.jobs['ci-required']
        self.assertEqual(gate['name'], 'CI required')
        self.assertEqual(gate['if'], 'always()')
        self.assertEqual(
            set(gate['needs']),
            {'changes', 'hooks', 'tests', 'workspace-browser', 'backward-python', 'build'},
        )
        alias = self.jobs['gates']
        self.assertEqual(alias['if'], 'always()')
        self.assertEqual(alias['needs'], ['ci-required'])

    def test_pull_requests_skip_heavy_jobs_and_never_run_python_312(self):
        self.assertEqual(
            self.jobs['backward-python']['if'], "github.event_name != 'pull_request'"
        )
        self.assertIn("!= 'pull_request'", self.jobs['build']['if'])
        self.assertIn("outputs.ui == 'true'", self.jobs['workspace-browser']['if'])
        self.assertIn("outputs.code == 'true'", self.jobs['tests']['if'])
        self.assertFalse((ROOT / '.github/workflows/gates-skip.yml').exists())

    def test_actual_gate_script_rejects_failed_and_cancelled_jobs(self):
        script = self.jobs['ci-required']['steps'][0]['run']
        states = ('success', 'failure', 'skipped', 'cancelled')
        for results in itertools.product(states, repeat=3):
            with self.subTest(results=results):
                result = subprocess.run(
                    ['/bin/bash', '-c', script],
                    env={'RESULTS': ' '.join(results)},
                    capture_output=True,
                    check=False,
                )
                expected = not {'failure', 'cancelled'} & set(results)
                self.assertEqual(result.returncode == 0, expected, result.stderr)


if __name__ == '__main__':
    unittest.main()
