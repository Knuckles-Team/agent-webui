"""Unit tests for the WebUI role ladder (`agent_webui.rbac`).

Self-contained: `rbac` imports nothing from `agent_utilities`, so these run
without the graph kernel and pin the resolution rules `oidc_session.py`'s
`/auth/session` and `server.py`'s `WebUIAuthorizationMiddleware` both depend
on for the SAME answer.
"""

from __future__ import annotations

from agent_webui.rbac import ROLE_ORDER, resolve_webui_role, role_at_least, role_rank


def test_role_order_is_reader_user_maintainer_admin():
    assert ROLE_ORDER == ('reader', 'user', 'maintainer', 'admin')


def test_role_rank_is_monotonic_and_unknown_role_ranks_below_everything():
    assert (
        role_rank('reader')
        < role_rank('user')
        < role_rank('maintainer')
        < role_rank('admin')
    )
    assert role_rank('not-a-role') == -1
    assert role_rank(None) == -1


def test_role_at_least_is_reflexive_and_directional():
    for role in ROLE_ORDER:
        assert role_at_least(role, role)
    assert role_at_least('admin', 'reader')
    assert not role_at_least('reader', 'admin')
    assert not role_at_least('user', 'maintainer')


def test_role_at_least_denies_everyone_for_an_unknown_minimum():
    assert not role_at_least('admin', 'superuser')


def test_unauthenticated_caller_resolves_to_no_role():
    assert resolve_webui_role(['webui:admin', 'kg:admin'], authenticated=False) is None


def test_authenticated_caller_with_no_matching_claim_defaults_to_reader():
    assert (
        resolve_webui_role(['offline_access', 'uma_authorization'], authenticated=True)
        == 'reader'
    )


def test_kg_scopes_fall_back_to_the_equivalent_webui_role():
    assert resolve_webui_role(['kg:admin'], authenticated=True) == 'admin'
    assert resolve_webui_role(['kg:write'], authenticated=True) == 'maintainer'
    assert resolve_webui_role(['kg:read'], authenticated=True) == 'user'


def test_kg_admin_implies_at_least_admin_even_alongside_lesser_scopes():
    assert (
        resolve_webui_role(['kg:read', 'kg:write', 'kg:admin'], authenticated=True)
        == 'admin'
    )


def test_explicit_webui_role_wins_over_the_kg_scope_fallback():
    assert (
        resolve_webui_role(['kg:admin', 'webui:reader'], authenticated=True) == 'reader'
    )
    assert (
        resolve_webui_role(['kg:read', 'webui:maintainer'], authenticated=True)
        == 'maintainer'
    )


def test_the_highest_ranked_explicit_webui_role_wins_when_several_are_present():
    assert (
        resolve_webui_role(
            ['webui:reader', 'webui:admin', 'webui:user'], authenticated=True
        )
        == 'admin'
    )


def test_an_unrecognised_explicit_webui_role_is_ignored_not_fatal():
    assert (
        resolve_webui_role(['webui:superuser', 'kg:write'], authenticated=True)
        == 'maintainer'
    )
