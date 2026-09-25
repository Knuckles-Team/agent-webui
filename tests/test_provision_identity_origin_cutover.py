"""The WebUI hostname cutover keeps only reviewed callbacks for one train."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'provision_identity.py'


def _provisioner(monkeypatch):
    monkeypatch.delenv('WEBUI_ORIGIN', raising=False)
    spec = importlib.util.spec_from_file_location(
        'provision_identity_origin_test', SCRIPT
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_cutover_adds_graphos_callback_and_keeps_only_reviewed_legacy_origins(
    monkeypatch,
):
    provisioner = _provisioner(monkeypatch)
    desired = provisioner._browser_client_config(retire_legacy_origin=False)

    assert provisioner.WEBUI_ORIGIN == 'https://graphos.arpa'
    assert desired['redirectUris'] == [
        'https://graphos.arpa/auth/callback',
        'https://au.arpa/auth/callback',
        'http://au.arpa/auth/callback',
    ]
    assert desired['webOrigins'] == [
        'https://graphos.arpa',
        'https://au.arpa',
        'http://au.arpa',
    ]
    assert desired['rootUrl'] == 'https://graphos.arpa'
    assert (
        desired['attributes']['post.logout.redirect.uris'] == 'https://graphos.arpa/*'
    )

    existing = {
        **desired,
        'redirectUris': [
            'https://au.arpa/auth/callback',
            'http://au.arpa/auth/callback',
            'https://unreviewed.example/auth/callback',
        ],
        'webOrigins': ['https://au.arpa', 'https://unreviewed.example'],
    }
    drift = provisioner._compute_client_drift(existing, desired)
    assert drift['redirectUris'] == sorted(desired['redirectUris'])
    assert drift['webOrigins'] == sorted(desired['webOrigins'])
    assert 'https://unreviewed.example/auth/callback' not in drift['redirectUris']
    assert 'https://unreviewed.example' not in drift['webOrigins']


def test_legacy_callbacks_remain_until_explicit_cleanup(monkeypatch):
    provisioner = _provisioner(monkeypatch)
    transitional = provisioner._browser_client_config(retire_legacy_origin=False)
    retired = provisioner._browser_client_config(retire_legacy_origin=True)

    assert retired['redirectUris'] == ['https://graphos.arpa/auth/callback']
    assert retired['webOrigins'] == ['https://graphos.arpa']
    assert provisioner._compute_client_drift(transitional, transitional) == {}
    drift = provisioner._compute_client_drift(transitional, retired)
    assert drift['redirectUris'] == retired['redirectUris']
    assert drift['webOrigins'] == retired['webOrigins']


def test_legacy_cleanup_requires_keycloak_only_stage(monkeypatch):
    provisioner = _provisioner(monkeypatch)
    monkeypatch.setattr(
        sys, 'argv', ['provision_identity.py', '--retire-legacy-origin']
    )
    with pytest.raises(SystemExit) as error:
        provisioner.main()
    assert error.value.code == 2

    calls = []
    monkeypatch.setattr(
        provisioner,
        'stage_keycloak',
        lambda users, dry_run, *, retire_legacy_origin: (
            calls.append(retire_legacy_origin) or {}
        ),
    )
    monkeypatch.setattr(
        sys,
        'argv',
        [
            'provision_identity.py',
            '--stage',
            'keycloak',
            '--retire-legacy-origin',
            '--dry-run',
        ],
    )
    assert provisioner.main() == 0
    assert calls == [True]

    monkeypatch.setattr(provisioner, 'WEBUI_ORIGIN', 'https://au.arpa')
    with pytest.raises(SystemExit) as error:
        provisioner.main()
    assert error.value.code == 2
