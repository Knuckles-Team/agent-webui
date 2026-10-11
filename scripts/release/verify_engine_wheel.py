#!/usr/bin/env python3
"""Verify a rolling EG release wheel before installation and record its identity."""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import re
from pathlib import Path
from typing import Any


def select_asset(release: dict[str, Any]) -> dict[str, Any]:
    """Preserve bootstrap's first matching Linux x86_64 wheel selection."""
    for asset in release['assets']:
        if fnmatch.fnmatch(asset['name'], 'epistemic_graph-*manylinux*x86_64.whl'):
            if not re.fullmatch(r'sha256:[0-9a-f]{64}', asset.get('digest') or ''):
                raise ValueError('selected engine wheel has no valid SHA-256 digest')
            return asset
    raise ValueError('release has no matching Linux x86_64 engine wheel')


def verify_wheel(release: dict[str, Any], wheel: Path) -> dict[str, Any]:
    asset = select_asset(release)
    with wheel.open('rb') as stream:
        digest = 'sha256:' + hashlib.file_digest(stream, 'sha256').hexdigest()
    if digest != asset['digest']:
        raise ValueError('engine wheel SHA-256 mismatch; refusing installation')
    return {
        'release_id': release['id'],
        'release_tag': release['tag_name'],
        'source_target': release['target_commitish'],
        'asset_id': asset['id'],
        'asset_name': asset['name'],
        'sha256': digest,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('release_metadata', type=Path)
    parser.add_argument('--wheel', type=Path)
    parser.add_argument('--receipt', type=Path)
    args = parser.parse_args()
    if bool(args.wheel) != bool(args.receipt):
        parser.error('--wheel and --receipt must be supplied together')
    release = json.loads(args.release_metadata.read_text(encoding='utf-8'))
    if args.wheel is None:
        print(select_asset(release)['browser_download_url'])
        return
    receipt = verify_wheel(release, args.wheel)
    encoded = json.dumps(receipt, indent=2, sort_keys=True) + '\n'
    args.receipt.write_text(encoded, encoding='utf-8')
    print(encoded, end='')


if __name__ == '__main__':
    main()
