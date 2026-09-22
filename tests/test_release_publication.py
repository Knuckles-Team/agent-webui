from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import urllib.error
from email.message import Message
from pathlib import Path
from types import ModuleType

import pytest

ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / 'scripts' / 'release' / 'check_pypi_artifacts.py'
WORKFLOW = ROOT / '.github' / 'workflows' / 'release.yml'


def _load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location('check_pypi_artifacts', SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _sha(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def test_absent_release_requires_publish() -> None:
    module = _load_script()
    assert module.publication_action({'package.whl': _sha(b'wheel')}, None) == 'publish'


def test_exact_existing_artifact_set_is_idempotent() -> None:
    module = _load_script()
    artifacts = {'package.whl': _sha(b'wheel'), 'package.tar.gz': _sha(b'sdist')}
    assert module.publication_action(artifacts, artifacts.copy()) == 'already-published'


def test_pypi_release_response_is_reduced_to_filename_digests() -> None:
    module = _load_script()
    payload = {
        'urls': [
            {'filename': 'package.whl', 'digests': {'sha256': 'wheel-digest'}},
            {'filename': 'package.tar.gz', 'digests': {'sha256': 'sdist-digest'}},
        ]
    }

    class Response(io.BytesIO):
        def __enter__(self) -> Response:
            return self

        def __exit__(self, *_args: object) -> None:
            self.close()

    def opener(url: str, *, timeout: int) -> Response:
        assert url.endswith('/agent-webui/2.6.0/json')
        assert timeout == 15
        return Response(json.dumps(payload).encode())

    assert module.pypi_artifact_digests('agent-webui', '2.6.0', opener=opener) == {
        'package.whl': 'wheel-digest',
        'package.tar.gz': 'sdist-digest',
    }


def test_pypi_404_means_version_is_absent() -> None:
    module = _load_script()

    def opener(url: str, *, timeout: int) -> None:
        raise urllib.error.HTTPError(url, 404, 'not found', Message(), None)

    assert module.pypi_artifact_digests('agent-webui', '99.0.0', opener=opener) is None


@pytest.mark.parametrize(
    ('remote', 'message'),
    [
        ({'package.whl': _sha(b'different')}, 'digest mismatch'),
        ({'package.whl': _sha(b'wheel')}, 'missing remotely'),
        (
            {'package.whl': _sha(b'wheel'), 'unexpected.zip': _sha(b'extra')},
            'unexpected remotely',
        ),
    ],
)
def test_existing_release_mismatch_is_never_skipped(
    remote: dict[str, str], message: str
) -> None:
    module = _load_script()
    local = {'package.whl': _sha(b'wheel'), 'package.tar.gz': _sha(b'sdist')}
    with pytest.raises(module.PublicationMismatch, match=message):
        module.publication_action(local, remote)


def test_release_workflow_preflights_and_rechecks_without_skip_existing() -> None:
    workflow = WORKFLOW.read_text(encoding='utf-8')
    assert (
        'check_pypi_artifacts.py pyproject.toml dist --github-output "$GITHUB_OUTPUT"'
        in workflow
    )
    assert "if: steps.pypi_preflight.outputs.publish == 'true'" in workflow
    assert '--expect-existing' in workflow
    assert '--skip-existing' not in workflow
    assert (
        'uses: ./.pipeline-contract/.github/actions/create-version-release' in workflow
    )
    assert 'needs: publish-pypi' in workflow
