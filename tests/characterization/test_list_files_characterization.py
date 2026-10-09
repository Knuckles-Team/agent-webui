"""Characterization tests for ``list_files`` (WC1-WEB-01).

``agent/agent_webui/__tests__/test_files_endpoints.py`` covers this function
through the HTTP layer, but every test in that file currently fails with a
401 on an UNMODIFIED, untouched canonical checkout of this repo (confirmed
identical on both `main` and this worktree before any change) -- the
``WebUIActorIdentityMiddleware`` now unconditionally rejects unauthenticated
requests and that file's ``TestClient`` fixture was never updated to present
a credential. That is a pre-existing, unrelated regression outside this
lane's partition (filed in the lane report), not evidence about
``list_files`` itself, so these tests call the function directly (the same
technique ``test_files_endpoints.py``'s own
``test_delete_file_rejects_path_traversal`` already uses for the same
auth-boundary reason) to get a real, currently-passing safety net for all
four of the function's branches.

Written and proven GREEN against the unmodified function. Must remain
byte-identical and green through the refactor commit.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from agent_webui import api_extensions
from agent_webui.api_extensions import list_files, set_workspace_helpers


@pytest.fixture(autouse=True)
def _clear_workspace_helpers():
    set_workspace_helpers({})
    yield
    set_workspace_helpers({})


def _run(limit: int = 1000) -> list[dict[str, Any]]:
    return asyncio.run(list_files(limit=limit))


def test_detailed_helper_branch_strips_private_keys_and_shortens_absolute_names():
    """Branch 1: a registered ``list_workspace_files_detailed`` helper is used
    verbatim, minus the private location keys, with an absolute ``name``
    shortened to its basename, and results are limited via ``itertools.islice``.
    """
    records = [
        {
            'name': '/abs/path/secret.md',
            'size': 3,
            'is_dir': False,
            'absolute_path': '/abs/path/secret.md',
            'local_path': '/abs/path/secret.md',
            'workspace_path': 'secret.md',
        },
        {'name': 'relative.md', 'size': 1, 'is_dir': False},
        {'name': 'dropped-by-limit.md', 'size': 1, 'is_dir': False},
    ]
    set_workspace_helpers({'list_workspace_files_detailed': lambda: records})

    result = _run(limit=2)

    assert result == [
        {'name': 'secret.md', 'size': 3, 'is_dir': False},
        {'name': 'relative.md', 'size': 1, 'is_dir': False},
    ]


def test_detailed_helper_branch_skips_non_dict_records():
    set_workspace_helpers(
        {'list_workspace_files_detailed': lambda: [42, {'name': 'ok.md'}]}
    )

    result = _run()

    assert result == [{'name': 'ok.md'}]


def test_get_workspace_path_helper_branch_lists_dirs_and_files(tmp_path):
    (tmp_path / 'sub').mkdir()
    (tmp_path / 'sub' / 'note.md').write_text('hi', encoding='utf-8')
    (tmp_path / 'ignored.bin').write_text('binary', encoding='utf-8')
    excluded = tmp_path / '.venv'
    excluded.mkdir()
    (excluded / 'inside.py').write_text('x', encoding='utf-8')

    set_workspace_helpers({'get_workspace_path': lambda p='': tmp_path / p})

    result = _run()
    by_name = {r['name']: r for r in result}

    assert by_name['sub']['is_dir'] is True
    assert by_name['sub/note.md']['is_dir'] is False
    assert by_name['sub/note.md']['size'] == 2
    assert 'ignored.bin' not in by_name
    assert not any(name.startswith('.venv') for name in by_name)


def test_get_workspace_path_helper_branch_respects_limit(tmp_path):
    for i in range(5):
        (tmp_path / f'f{i}.md').write_text('x', encoding='utf-8')
    set_workspace_helpers({'get_workspace_path': lambda p='': tmp_path / p})

    result = _run(limit=2)

    assert len(result) == 2


def test_get_workspace_path_helper_falls_through_when_path_missing(
    tmp_path, monkeypatch
):
    """When the registered path does not exist, branch 2 must NOT return --
    it falls through to branch 3/4 (here: the empty-config fallback branch).
    """
    missing = tmp_path / 'does-not-exist'
    set_workspace_helpers({'get_workspace_path': lambda p='': missing})

    fallback_base = tmp_path / 'fallback'
    fallback_base.mkdir()
    (fallback_base / 'landed.md').write_text('x', encoding='utf-8')
    monkeypatch.setattr(api_extensions, 'get_workspace_dir', lambda: fallback_base)

    import agent_utilities.core.workspace_config as workspace_config

    monkeypatch.setattr(workspace_config, 'load_workspace_yml', lambda: None)

    result = _run()

    assert result == [
        {
            'name': 'landed.md',
            'size': 1,
            'modified_iso': result[0]['modified_iso'],
            'is_dir': False,
        }
    ]


def test_configured_repositories_branch_scans_each_repo(tmp_path, monkeypatch):
    repo_a = tmp_path / 'repo-a'
    repo_a.mkdir()
    (repo_a / 'a.py').write_text('x', encoding='utf-8')
    repo_b = tmp_path / 'repo-b'
    repo_b.mkdir()
    (repo_b / 'b.py').write_text('x', encoding='utf-8')

    import agent_utilities.core.workspace_config as workspace_config

    monkeypatch.setattr(
        workspace_config, 'load_workspace_yml', lambda: {'path': str(tmp_path)}
    )
    monkeypatch.setattr(
        workspace_config,
        '_extract_repositories',
        lambda data, base_path: [(repo_a, 'repo-a'), (repo_b, 'repo-b')],
    )

    result = _run()
    names = {r['name'] for r in result}

    assert names == {'repo-a/a.py', 'repo-b/b.py'}


def test_configured_repositories_branch_stops_at_limit_across_repos(
    tmp_path, monkeypatch
):
    repo_a = tmp_path / 'repo-a'
    repo_a.mkdir()
    for i in range(3):
        (repo_a / f'a{i}.py').write_text('x', encoding='utf-8')
    repo_b = tmp_path / 'repo-b'
    repo_b.mkdir()
    (repo_b / 'b0.py').write_text('x', encoding='utf-8')

    import agent_utilities.core.workspace_config as workspace_config

    monkeypatch.setattr(
        workspace_config, 'load_workspace_yml', lambda: {'path': str(tmp_path)}
    )
    monkeypatch.setattr(
        workspace_config,
        '_extract_repositories',
        lambda data, base_path: [(repo_a, 'repo-a'), (repo_b, 'repo-b')],
    )

    result = _run(limit=2)

    assert len(result) == 2
    assert all(r['name'].startswith('repo-a/') for r in result)


def test_fallback_branch_used_when_no_helpers_and_no_config(tmp_path, monkeypatch):
    (tmp_path / 'only.md').write_text('x', encoding='utf-8')

    import agent_utilities.core.workspace_config as workspace_config

    monkeypatch.setattr(workspace_config, 'load_workspace_yml', lambda: None)
    monkeypatch.setattr(api_extensions, 'get_workspace_dir', lambda: tmp_path)

    result = _run()

    assert [r['name'] for r in result] == ['only.md']


def test_fallback_branch_not_used_when_config_scan_already_found_results(
    tmp_path, monkeypatch
):
    repo_a = tmp_path / 'repo-a'
    repo_a.mkdir()
    (repo_a / 'a.py').write_text('x', encoding='utf-8')

    fallback_base = tmp_path / 'fallback-should-not-be-scanned'
    fallback_base.mkdir()
    (fallback_base / 'should-not-appear.md').write_text('x', encoding='utf-8')

    import agent_utilities.core.workspace_config as workspace_config

    monkeypatch.setattr(
        workspace_config, 'load_workspace_yml', lambda: {'path': str(tmp_path)}
    )
    monkeypatch.setattr(
        workspace_config,
        '_extract_repositories',
        lambda data, base_path: [(repo_a, 'repo-a')],
    )
    monkeypatch.setattr(api_extensions, 'get_workspace_dir', lambda: fallback_base)

    result = _run()

    assert [r['name'] for r in result] == ['repo-a/a.py']
