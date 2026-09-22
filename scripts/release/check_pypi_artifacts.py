#!/usr/bin/env python3
"""Decide whether a built distribution needs publishing to PyPI.

An existing version is successful only when PyPI has the exact same artifact
filenames and SHA-256 digests.  This is deliberately stricter than Twine's
``--skip-existing`` behavior, which can hide a rebuild under an immutable
version number.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

import tomllib

PYPI_RELEASE_URL = 'https://pypi.org/pypi/{project}/{version}/json'
PUBLISHABLE_SUFFIXES = ('.whl', '.tar.gz')


class PublicationMismatch(RuntimeError):
    """The immutable PyPI version exists with different artifacts."""


def project_identity(pyproject: Path) -> tuple[str, str]:
    payload = tomllib.loads(pyproject.read_text(encoding='utf-8'))
    project = payload.get('project', {})
    name = project.get('name')
    version = project.get('version')
    if not isinstance(name, str) or not isinstance(version, str):
        raise ValueError(
            f'{pyproject} must declare string project.name and project.version'
        )
    return name, version


def is_publishable_artifact(path: Path) -> bool:
    """Return whether *path* is a wheel or source distribution."""
    return path.is_file() and path.name.endswith(PUBLISHABLE_SUFFIXES)


def artifact_digests(dist_dir: Path) -> dict[str, str]:
    artifacts = sorted(
        path for path in dist_dir.iterdir() if is_publishable_artifact(path)
    )
    if not artifacts:
        raise ValueError(f'no distribution artifacts found in {dist_dir}')
    return {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in artifacts
    }


def pypi_artifact_digests(
    project: str,
    version: str,
    *,
    opener: Callable[..., Any] = urllib.request.urlopen,
) -> dict[str, str] | None:
    url = PYPI_RELEASE_URL.format(
        project=urllib.parse.quote(project, safe=''),
        version=urllib.parse.quote(version, safe=''),
    )
    try:
        with opener(url, timeout=15) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise
    return {
        entry['filename']: entry['digests']['sha256']
        for entry in payload.get('urls', [])
        if isinstance(entry, dict)
        and isinstance(entry.get('filename'), str)
        and isinstance(entry.get('digests'), dict)
        and isinstance(entry['digests'].get('sha256'), str)
    }


def publication_action(local: dict[str, str], remote: dict[str, str] | None) -> str:
    if remote is None:
        return 'publish'
    if local == remote:
        return 'already-published'
    local_names = set(local)
    remote_names = set(remote)
    missing = sorted(local_names - remote_names)
    unexpected = sorted(remote_names - local_names)
    changed = sorted(
        name for name in local_names & remote_names if local[name] != remote[name]
    )
    details = []
    if missing:
        details.append(f'missing remotely: {", ".join(missing)}')
    if unexpected:
        details.append(f'unexpected remotely: {", ".join(unexpected)}')
    if changed:
        details.append(f'digest mismatch: {", ".join(changed)}')
    raise PublicationMismatch('; '.join(details))


def write_github_output(path: Path | None, *, publish: bool) -> None:
    if path is None:
        return
    with path.open('a', encoding='utf-8') as output:
        output.write(f'publish={str(publish).lower()}\n')
        output.write(f'already_published={str(not publish).lower()}\n')


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument('pyproject', type=Path)
    parser.add_argument('dist_dir', type=Path)
    parser.add_argument('--github-output', type=Path)
    parser.add_argument('--expect-existing', action='store_true')
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    name, version = project_identity(args.pyproject)
    local = artifact_digests(args.dist_dir)
    try:
        action = publication_action(local, pypi_artifact_digests(name, version))
    except PublicationMismatch as error:
        print(
            f'::error::PyPI {name}=={version} exists with non-identical artifacts: {error}. '
            'Bump the project version; refusing to hide an immutable-release mismatch.',
            file=sys.stderr,
        )
        return 1
    if action == 'publish' and args.expect_existing:
        print(
            f'::error::PyPI {name}=={version} is still absent after the upload failed.',
            file=sys.stderr,
        )
        return 1
    publish = action == 'publish'
    write_github_output(args.github_output, publish=publish)
    if publish:
        print(f'PyPI {name}=={version} is absent; publication is required.')
    else:
        print(
            f'PyPI {name}=={version} already contains the exact built artifact set; publication is complete.'
        )
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
