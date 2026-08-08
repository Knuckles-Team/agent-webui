"""Tests for the enriched workspace file endpoints.

Covers:
* ``GET /api/enhanced/files`` returning rich dict records via both the
  ``list_workspace_files_detailed`` helper fast-path and the pathlib
  fallback.
* ``DELETE /api/enhanced/files/{filename}`` happy-path, path-traversal
  rejection, and directory refusal.

These tests complement the minimal smoke coverage in
``test_api_extensions_extended.py``.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from agent_webui.server import create_agent_web_app
from fastapi.testclient import TestClient


def _make_client(mock_agent, helpers: dict) -> TestClient:
    app = create_agent_web_app(mock_agent, helpers)
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def workspace_client(mock_agent, tmp_path):
    """Client whose ``get_workspace_path`` helper points at ``tmp_path``.

    The workspace-root lookup is the primary hook the new endpoints rely
    on: the GET fallback iterates it for metadata, the DELETE endpoint
    resolves filenames against it for path-traversal defense.
    """
    helpers = {
        'agent_name': 'Files Agent',
        'agent_description': 'Desc',
        'agent_emoji': '📁',
        'list_workspace_files': MagicMock(return_value=[]),
        'write_md_file': MagicMock(return_value=None),
        'get_workspace_path': MagicMock(side_effect=lambda p='': tmp_path / p),
    }
    return _make_client(mock_agent, helpers), tmp_path, helpers


def test_list_files_returns_metadata_for_uploaded_file(workspace_client):
    """After writing a file the GET listing should include its metadata."""
    client, tmp_path, _helpers = workspace_client

    target = tmp_path / 'notes.md'
    target.write_text('hello world', encoding='utf-8')

    response = client.get('/api/enhanced/files')
    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload, list)

    by_name = {entry['name']: entry for entry in payload}
    assert 'notes.md' in by_name
    record = by_name['notes.md']
    assert record['size'] == len('hello world')
    assert isinstance(record['modified_iso'], str)
    assert record['is_dir'] is False


def test_list_files_marks_directories(workspace_client):
    """Sub-directories should appear with ``is_dir=True``."""
    client, tmp_path, _helpers = workspace_client
    (tmp_path / 'sub').mkdir()

    response = client.get('/api/enhanced/files')
    assert response.status_code == 200
    payload = response.json()
    by_name = {entry['name']: entry for entry in payload}
    assert by_name['sub']['is_dir'] is True


def test_list_files_uses_detailed_helper_when_registered(mock_agent, tmp_path):
    """If a ``list_workspace_files_detailed`` helper is registered it is
    used verbatim and pathlib is not touched.
    """
    detailed_records = [
        {
            'name': 'custom.md',
            'size': 42,
            'modified_iso': '2024-01-01T00:00:00+00:00',
            'is_dir': False,
        }
    ]
    helpers = {
        'list_workspace_files_detailed': MagicMock(return_value=detailed_records),
        # NOTE: no ``get_workspace_path`` → fallback path would 501.
    }
    client = _make_client(mock_agent, helpers)

    response = client.get('/api/enhanced/files')
    assert response.status_code == 200
    assert response.json() == detailed_records
    helpers['list_workspace_files_detailed'].assert_called_once()


def test_delete_file_happy_path(workspace_client):
    """PUT-then-DELETE cycle removes the file from disk and the listing."""
    client, tmp_path, _helpers = workspace_client

    # Create a file via PUT (the endpoint only allows .md / .json).
    put_response = client.put(
        '/api/enhanced/files/draft.md', json={'content': 'draft body'}
    )
    assert put_response.status_code == 200

    # The helper fixture uses a MagicMock for write_md_file, so the file
    # isn't actually written. Materialize it by hand to exercise DELETE.
    target = tmp_path / 'draft.md'
    target.write_text('draft body', encoding='utf-8')
    assert target.exists()

    response = client.delete('/api/enhanced/files/draft.md')
    assert response.status_code == 200
    body = response.json()
    assert body == {'status': 'ok', 'deleted': 'draft.md'}
    assert not target.exists()


def test_delete_file_not_found(workspace_client):
    client, _tmp_path, _helpers = workspace_client

    response = client.delete('/api/enhanced/files/does-not-exist.md')
    assert response.status_code == 200
    body = response.json()
    assert body['status'] == 'error'
    assert body['detail'] == 'not found'


def test_delete_file_rejects_path_traversal(mock_agent, tmp_path):
    """A filename that resolves outside the workspace must be rejected.

    Exercised at the handler level because FastAPI's ``{filename}`` path
    param only captures a single URL segment and Starlette's HTTP layer
    aggressively normalizes ``..`` / ``%2F`` sequences out before the
    request ever reaches the endpoint. The handler's own resolve-and-
    compare check is still the security boundary, so we call
    ``delete_workspace_file`` directly with an embedded traversal.
    """
    import asyncio

    from agent_webui.api_extensions import delete_workspace_file, set_workspace_helpers

    outside = tmp_path.parent / 'unit_secret.txt'
    outside.write_text('classified', encoding='utf-8')
    try:
        set_workspace_helpers({'get_workspace_path': lambda p='': tmp_path / p})
        result = asyncio.run(delete_workspace_file('../unit_secret.txt'))
        assert result['status'] == 'error'
        assert result['detail'] == 'path outside workspace'
        assert outside.exists()
    finally:
        set_workspace_helpers({})
        if outside.exists():
            outside.unlink()


def test_delete_file_refuses_directory(workspace_client):
    """DELETE on a directory entry is rejected with a clear error."""
    client, tmp_path, _helpers = workspace_client
    (tmp_path / 'bucket').mkdir()

    response = client.delete('/api/enhanced/files/bucket')
    assert response.status_code == 200
    body = response.json()
    assert body['status'] == 'error'
    assert body['detail'] == 'refusing to delete directory'
    assert (tmp_path / 'bucket').is_dir()


def test_delete_file_without_helper_returns_error(mock_agent):
    """If no workspace helper is registered, DELETE fails gracefully."""
    client = _make_client(mock_agent, {})

    response = client.delete('/api/enhanced/files/something.md')
    assert response.status_code == 200
    body = response.json()
    assert body['status'] == 'error'
    assert 'workspace helper' in body['detail']


def test_upload_and_download_stay_inside_workspace(workspace_client):
    """A normal upload is stored and served from the configured workspace."""
    client, tmp_path, _helpers = workspace_client

    upload = client.post(
        '/api/enhanced/upload',
        files={'file': ('evidence.txt', b'grounded', 'text/plain')},
    )
    assert upload.status_code == 200
    assert upload.json() == {'filename': 'evidence.txt'}
    assert (tmp_path / 'evidence.txt').read_bytes() == b'grounded'

    download = client.get('/api/enhanced/download/evidence.txt')
    assert download.status_code == 200
    assert download.content == b'grounded'


@pytest.mark.parametrize(
    'filename',
    ['../escaped.txt', '/tmp/escaped.txt', r'..\escaped.txt'],  # nosec B108 -- attack-payload fixtures asserting rejection, not real temp-file usage
)
def test_upload_rejects_path_bearing_filename(workspace_client, filename):
    client, tmp_path, _helpers = workspace_client
    outside = tmp_path.parent / 'escaped.txt'
    outside.unlink(missing_ok=True)

    response = client.post(
        '/api/enhanced/upload',
        files={'file': (filename, b'should-not-write', 'text/plain')},
    )

    assert response.status_code == 400
    assert not outside.exists()


def test_download_rejects_traversal_at_handler_boundary(mock_agent, tmp_path):
    """The resolved download target may never escape through ``..`` or a symlink."""
    import asyncio

    from agent_webui.api_extensions import download_file, set_workspace_helpers
    from fastapi import HTTPException

    outside = tmp_path.parent / 'download_secret.txt'
    outside.write_text('classified', encoding='utf-8')
    try:
        set_workspace_helpers({'get_workspace_path': lambda p='': tmp_path / p})
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(download_file('../download_secret.txt'))
        assert exc_info.value.status_code == 400
        assert 'download_secret.txt' not in str(exc_info.value.detail)
        assert outside.exists()
    finally:
        set_workspace_helpers({})
        outside.unlink(missing_ok=True)
