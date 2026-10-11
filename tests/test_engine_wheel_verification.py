"""Fixture-only checks for rolling engine wheel integrity and bootstrap order."""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / 'scripts/release/verify_engine_wheel.py'
SPEC = importlib.util.spec_from_file_location('verify_engine_wheel', SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class EngineWheelVerificationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.wheel = Path(self.directory.name) / 'engine.whl'
        self.wheel.write_bytes(b'synthetic wheel fixture')
        self.asset = {
            'id': 24,
            'name': 'epistemic_graph-2.27.0-py3-none-manylinux_2_28_x86_64.whl',
            'digest': 'sha256:' + hashlib.sha256(self.wheel.read_bytes()).hexdigest(),
            'browser_download_url': 'https://example.invalid/synthetic.whl',
        }
        self.release = {
            'id': 12,
            'tag_name': 'engine-main',
            'target_commitish': 'a' * 40,
            'assets': [self.asset],
        }

    def test_matching_download_records_selected_identity(self) -> None:
        receipt = MODULE.verify_wheel(self.release, self.wheel)
        self.assertEqual(
            receipt,
            {
                'release_id': 12,
                'release_tag': 'engine-main',
                'source_target': 'a' * 40,
                'asset_id': 24,
                'asset_name': self.asset['name'],
                'sha256': self.asset['digest'],
            },
        )

    def test_changed_download_is_refused(self) -> None:
        self.wheel.write_bytes(b'tampered synthetic wheel')
        with self.assertRaisesRegex(ValueError, 'mismatch'):
            MODULE.verify_wheel(self.release, self.wheel)

    def test_missing_or_malformed_digest_is_refused(self) -> None:
        for digest in (None, '', 'sha256:abc', 'md5:' + 'a' * 64):
            with self.subTest(digest=digest):
                self.asset['digest'] = digest
                with self.assertRaisesRegex(ValueError, 'valid SHA-256'):
                    MODULE.select_asset(self.release)

    def test_first_matching_platform_is_preserved(self) -> None:
        other = copy.deepcopy(self.asset)
        other.update(id=25, name='epistemic_graph-2.27.0-manylinux_aarch64.whl')
        later = copy.deepcopy(self.asset)
        later['id'] = 26
        self.release['assets'] = [other, self.asset, later]
        self.assertEqual(MODULE.select_asset(self.release)['id'], 24)

    def test_absent_matching_platform_is_refused(self) -> None:
        self.release['assets'] = []
        with self.assertRaisesRegex(ValueError, 'no matching'):
            MODULE.select_asset(self.release)

    def test_cli_writes_receipt_only_for_verified_download(self) -> None:
        metadata = Path(self.directory.name) / 'release.json'
        metadata.write_text(json.dumps(self.release), encoding='utf-8')
        receipt = Path(self.directory.name) / 'receipt.json'
        command = [
            sys.executable,
            str(SCRIPT),
            str(metadata),
            '--wheel',
            str(self.wheel),
            '--receipt',
            str(receipt),
        ]
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(receipt.read_text())['asset_id'], 24)
        receipt.unlink()
        self.wheel.write_bytes(b'corrupt download fixture')
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('SHA-256 mismatch', result.stderr)
        self.assertFalse(receipt.exists())

    def test_bootstrap_verifies_before_install_and_certifies_before_receipt(
        self,
    ) -> None:
        script = (ROOT / 'scripts/bootstrap.sh').read_text(encoding='utf-8')
        invalidate = script.index('rm -f .venv/engine-wheel-receipt.json')
        sync = script.index('"${SYNC[@]}"')
        verify = script.index('--wheel "$wheel_dir/')
        install = script.index('uv pip install --python .venv/bin/python')
        certify = script.index('import agent_utilities.numeric')
        receipt = script.index('cp "$wheel_dir/receipt.json"')
        self.assertLess(invalidate, sync)
        self.assertLess(sync, verify)
        self.assertLess(verify, install)
        self.assertLess(install, certify)
        self.assertLess(certify, receipt)


if __name__ == '__main__':
    unittest.main()
