"""Wiring tests for `scripts/provision_identity.py`'s `tier2-admission` stage
(BUG-068/BUG-038).

`agent_utilities.security.engine_rbac_admission.provision_tier2_admission`
existed, fully unit-tested, with zero live callers -- the module's own
docstring named THIS script as the Tier-1 counterpart responsible for calling
it, and nothing did. These tests prove `stage_tier2_admission()` is a real,
reachable entrypoint: it resolves the webui service account's Keycloak
identity, builds the admission manifest from it, calls the deployment-tooling
bridge (`agent_utilities.security.tier2_admission_cli.run_tier2_admission`),
and is wired into `main()`'s default stage list -- without ever constructing a
`LiveEngineAdmissionClient` or touching a live engine/secrets backend. Per
BUG-068's explicit instruction, no test here invokes the admin RPC against a
live cluster; `run_tier2_admission` itself is mocked at exactly this script's
boundary, mirroring how `_admin_token`/`_find_client` mock the Keycloak
boundary -- the seam under test is THIS script's wiring, not the bridge
module's own internals (already proven in agent-utilities'
`tests/unit/security/test_tier2_admission_cli.py`).
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

import pytest

SCRIPT_PATH = Path(__file__).resolve().parents[1] / 'scripts' / 'provision_identity.py'


def _load_module() -> ModuleType:
    """Load `scripts/provision_identity.py` as an isolated module per test --
    it is a standalone script (no `__init__.py` package), so this avoids
    sys.path manipulation and guarantees a fresh module object per test."""

    spec = importlib.util.spec_from_file_location(
        'provision_identity_under_test', SCRIPT_PATH
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def pi() -> ModuleType:
    return _load_module()


def _admission_result(**overrides):
    from agent_utilities.security.engine_rbac_admission import AdmissionResult

    defaults = dict(
        bootstrap_attempted=True,
        bootstrap_succeeded=False,
        bootstrap_already_consumed=True,
        outcomes=(),
    )
    defaults.update(overrides)
    return AdmissionResult(**defaults)


# ---------------------------------------------------------------------------
# The stage is wired into main()'s default flow
# ---------------------------------------------------------------------------


def _record_stage_calls(pi, monkeypatch, calls: list[str]) -> None:
    """Replace all four stage functions with recorders, in place, so a
    `main()` run proves ORDER and MEMBERSHIP without touching Keycloak/
    OpenBao/kubectl/the engine."""

    def _keycloak(*_a, **_k) -> dict[str, str]:
        calls.append('keycloak')
        return {}

    def _tier2(*_a, **_k) -> None:
        calls.append('tier2-admission')

    def _openbao(*_a, **_k) -> None:
        calls.append('openbao')

    def _kubernetes(*_a, **_k) -> None:
        calls.append('kubernetes')

    monkeypatch.setattr(pi, 'stage_keycloak', _keycloak)
    monkeypatch.setattr(pi, 'stage_tier2_admission', _tier2)
    monkeypatch.setattr(pi, 'stage_openbao', _openbao)
    monkeypatch.setattr(pi, 'stage_kubernetes', _kubernetes)


def test_tier2_admission_runs_by_default_between_keycloak_and_openbao(
    pi, monkeypatch
) -> None:
    calls: list[str] = []
    _record_stage_calls(pi, monkeypatch, calls)
    monkeypatch.setattr(sys, 'argv', ['provision_identity.py', '--dry-run'])

    exit_code = pi.main()

    assert exit_code == 0
    assert calls == ['keycloak', 'tier2-admission', 'openbao', 'kubernetes']


def test_tier2_admission_is_independently_selectable_via_stage_flag(
    pi, monkeypatch
) -> None:
    calls: list[str] = []
    _record_stage_calls(pi, monkeypatch, calls)
    monkeypatch.setattr(
        sys,
        'argv',
        ['provision_identity.py', '--stage', 'tier2-admission', '--dry-run'],
    )

    exit_code = pi.main()

    assert exit_code == 0
    assert calls == ['tier2-admission']


# ---------------------------------------------------------------------------
# stage_tier2_admission(): builds the manifest from the RESOLVED principal
# ---------------------------------------------------------------------------


def test_stage_builds_manifest_from_the_resolved_service_account_principal(
    pi, monkeypatch
) -> None:
    monkeypatch.setattr(pi, '_admin_token', lambda: 'admin-token')
    monkeypatch.setattr(
        pi, '_find_client', lambda token, client_id: {'id': 'kc-internal-uuid'}
    )
    monkeypatch.setattr(
        pi,
        '_service_account_user_id',
        lambda token, uuid, client_id: 'principal-uuid-123',
    )

    import agent_utilities.security.tier2_admission_cli as t2cli
    from agent_utilities.security.engine_rbac_admission import AdmissionOutcome

    captured: dict = {}

    def fake_run(manifest, *, apply):
        captured['manifest'] = manifest
        captured['apply'] = apply
        return _admission_result(
            bootstrap_succeeded=True,
            bootstrap_already_consumed=False,
            outcomes=(
                AdmissionOutcome(
                    agent_id='principal-uuid-123',
                    bootstrapped=False,
                    admitted=True,
                    detail="granted role 'webui-cluster-read'",
                ),
            ),
        )

    monkeypatch.setattr(t2cli, 'run_tier2_admission', fake_run)

    pi.stage_tier2_admission(dry_run=False)

    manifest = captured['manifest']
    assert len(manifest) == 1
    entry = manifest[0]
    # The Keycloak SERVICE ACCOUNT USER ID -- not the literal client id -- is
    # what becomes VerifiedRequestContext.agent_id at request time (see
    # `_service_account_user_id`'s own docstring). The grant MUST key on it.
    assert entry.agent_id == 'principal-uuid-123'
    assert entry.tier2_actions == ('admin:cluster-read',)
    # Minimum grant: a narrow named role, never unconditional System.
    assert entry.grant_mode == 'admin_grant'
    assert entry.role == pi.TIER2_ADMISSION_ROLE
    assert entry.role != 'System'
    # dry_run=False -> a REAL apply, not a preview.
    assert captured['apply'] is True


def test_stage_dry_run_previews_without_applying(pi, monkeypatch, capsys) -> None:
    monkeypatch.setattr(pi, '_admin_token', lambda: 'admin-token')
    monkeypatch.setattr(
        pi, '_find_client', lambda token, client_id: {'id': 'kc-internal-uuid'}
    )
    monkeypatch.setattr(
        pi,
        '_service_account_user_id',
        lambda token, uuid, client_id: 'principal-uuid-123',
    )

    import agent_utilities.security.tier2_admission_cli as t2cli

    captured: dict = {}

    def fake_run(manifest, *, apply):
        captured['apply'] = apply
        return _admission_result()

    monkeypatch.setattr(t2cli, 'run_tier2_admission', fake_run)

    pi.stage_tier2_admission(dry_run=True)

    assert captured['apply'] is False
    out = capsys.readouterr().out
    assert 'principal-uuid-123' in out
    assert 'PREVIEW ONLY' in out


# ---------------------------------------------------------------------------
# Fail loud -- never a silent under-admitted service (BUG-038's whole point)
# ---------------------------------------------------------------------------


def test_a_failed_admission_becomes_a_provisioning_error_not_a_silent_pass(
    pi, monkeypatch
) -> None:
    monkeypatch.setattr(pi, '_admin_token', lambda: 'admin-token')
    monkeypatch.setattr(
        pi, '_find_client', lambda token, client_id: {'id': 'kc-internal-uuid'}
    )
    monkeypatch.setattr(
        pi,
        '_service_account_user_id',
        lambda token, uuid, client_id: 'principal-uuid-123',
    )

    import agent_utilities.security.tier2_admission_cli as t2cli

    def fake_run(manifest, *, apply):
        raise t2cli.Tier2AdmissionError('engine unreachable')

    monkeypatch.setattr(t2cli, 'run_tier2_admission', fake_run)

    with pytest.raises(pi.ProvisioningError, match='Tier-2 engine admission failed'):
        pi.stage_tier2_admission(dry_run=False)


def test_missing_keycloak_client_fails_loud_before_any_admission_attempt(
    pi, monkeypatch
) -> None:
    monkeypatch.setattr(pi, '_admin_token', lambda: 'admin-token')
    monkeypatch.setattr(pi, '_find_client', lambda token, client_id: None)

    with pytest.raises(pi.ProvisioningError, match='Keycloak client not found'):
        pi.stage_tier2_admission(dry_run=False)


def test_a_partial_admission_result_is_also_a_provisioning_error(
    pi, monkeypatch
) -> None:
    """`provision_tier2_admission` itself never returns a partial success (an
    error always propagates) -- but this stage's own contract is to also
    check `all_admitted` and fail loud if a future change ever made that
    possible, rather than trust a result object blindly."""

    monkeypatch.setattr(pi, '_admin_token', lambda: 'admin-token')
    monkeypatch.setattr(
        pi, '_find_client', lambda token, client_id: {'id': 'kc-internal-uuid'}
    )
    monkeypatch.setattr(
        pi,
        '_service_account_user_id',
        lambda token, uuid, client_id: 'principal-uuid-123',
    )

    import agent_utilities.security.tier2_admission_cli as t2cli
    from agent_utilities.security.engine_rbac_admission import AdmissionOutcome

    def fake_run(manifest, *, apply):
        return _admission_result(
            outcomes=(
                AdmissionOutcome(
                    agent_id='principal-uuid-123',
                    bootstrapped=False,
                    admitted=False,
                    detail='not admitted',
                ),
            )
        )

    monkeypatch.setattr(t2cli, 'run_tier2_admission', fake_run)

    with pytest.raises(pi.ProvisioningError, match='did not complete'):
        pi.stage_tier2_admission(dry_run=False)
