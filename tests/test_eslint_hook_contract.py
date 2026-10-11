"""Keep serial typed lint scoped to the same files and mandatory stages."""

from __future__ import annotations

import re
import subprocess
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]


class EslintHookContractTests(unittest.TestCase):
    def setUp(self):
        self.config = yaml.safe_load((ROOT / '.config/pre-commit.yaml').read_text())
        self.hook = next(
            hook
            for repo in self.config['repos']
            for hook in repo['hooks']
            if hook['id'] == 'eslint-staged'
        )

    def test_serial_hook_preserves_command_filters_and_stages(self):
        expected = {
            'id': 'eslint-staged',
            'name': 'eslint (staged .ts/.tsx) - errors block, warnings (incl. jsx-a11y) reported only',
            'entry': (
                'python3 scripts/run_if_available.py --gate eslint-staged '
                '--require node_modules/.bin/eslint --require pnpm -- pnpm exec eslint'
            ),
            'language': 'system',
            'files': r'\.(ts|tsx)$',
            'exclude': '^scripts/',
            'stages': ['pre-commit', 'pre-push', 'manual'],
            'require_serial': True,
        }
        self.assertEqual(self.hook, expected)
        self.assertTrue(self.hook.get('pass_filenames', True))

    def test_tracked_scope_is_unchanged(self):
        tracked = (
            subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT)
            .decode()
            .split('\0')
        )
        eligible = [
            path
            for path in tracked
            if path and not re.search(self.config['exclude'], path)
        ]
        selected = [
            path
            for path in eligible
            if re.search(self.hook['files'], path)
            and not re.search(self.hook['exclude'], path)
        ]
        previous = [
            path
            for path in eligible
            if path.endswith(('.ts', '.tsx')) and not path.startswith('scripts/')
        ]
        self.assertTrue(previous)
        self.assertEqual(selected, previous)

    def test_full_manual_lint_is_unchanged(self):
        hook = next(
            hook
            for repo in self.config['repos']
            for hook in repo['hooks']
            if hook['id'] == 'lint'
        )
        self.assertEqual(
            hook['entry'],
            (
                'python3 scripts/run_if_available.py --gate lint '
                '--require node_modules/.bin/eslint --require pnpm -- pnpm exec eslint'
            ),
        )
        self.assertEqual(hook['stages'], ['manual'])
        self.assertFalse(hook['pass_filenames'])
        self.assertTrue(hook['always_run'])


if __name__ == '__main__':
    unittest.main()
