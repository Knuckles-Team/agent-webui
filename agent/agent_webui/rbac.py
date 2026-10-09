#!/usr/bin/python
"""The WebUI's page/feature role ladder: ``reader < user < maintainer < admin``.

This is a **separate axis** from the KG graph-authority scopes
(``kg:read`` / ``kg:write`` / ``kg:admin``) that
:class:`agent_webui.server.WebUIAuthorizationMiddleware` already enforces for
every route. Those scopes answer "how much may this caller do to the graph";
this ladder answers "which pages/features of the WebUI itself may this caller
reach" — the same ``minRole`` concept ``src/lib/nav-registry.ts`` declares per
route (``RouteDef.minRole``).

Identity comes from the existing OIDC provider (Keycloak) via the same
verified actor the graph-authority scopes already come from — there is no
second auth path. ``resolve_webui_role`` reads the actor's full realm role set
(:class:`agent_utilities.security.brain_context.ActorContext.roles`, not the
``kg:*``-filtered subset :attr:`GraphSession.scopes` carries) and:

1. Prefers an explicit ``webui:<role>`` realm role (highest-ranked one wins)
   — the intended long-term source: an operator assigns ``webui:admin`` /
   ``webui:maintainer`` / ``webui:user`` / ``webui:reader`` directly in
   Keycloak.
2. Falls back to the existing coarse KG scopes (``kg:admin`` -> admin,
   ``kg:write`` -> maintainer, ``kg:read`` -> user) so introducing this
   ladder requires **no new Keycloak configuration** to keep today's access
   working — anyone who already depended on a ``kg:*`` scope for something
   keeps at least the equivalent WebUI role.
3. Falls back to ``'reader'`` for any other authenticated identity with no
   matching claim — the safe default: never grant more than read/
   documentation access to an identity this module cannot positively
   classify.
4. Returns ``None`` for an unauthenticated caller; callers decide what that
   means (redirect to sign-in, or "identity is not enforced at all here").

``agent/agent_webui/oidc_session.py`` reports the result at
``GET /auth/session`` as ``webui_role`` so the frontend (``src/lib/auth.ts``)
never re-derives a role from raw claims — it only reads what this module
already decided, which is what keeps the UI's nav filtering and the server's
enforcement (:class:`agent_webui.server.WebUIAuthorizationMiddleware`) from
being able to disagree.
"""

from __future__ import annotations

from collections.abc import Iterable

__all__ = [
    'ROLE_ORDER',
    'role_rank',
    'role_at_least',
    'resolve_webui_role',
]

#: Ascending privilege order. Mirrors ``ROLE_ORDER`` in ``src/lib/nav-registry.ts``
#: exactly — the two are the same ladder in two languages, not two ladders.
ROLE_ORDER: tuple[str, ...] = ('reader', 'user', 'maintainer', 'admin')

_ROLE_RANK: dict[str, int] = {role: index for index, role in enumerate(ROLE_ORDER)}
_WEBUI_ROLE_PREFIX = 'webui:'


def role_rank(role: str | None) -> int:
    """Return `role`'s rank on the ladder, or ``-1`` for an unknown/missing role."""

    if role is None:
        return -1
    return _ROLE_RANK.get(role, -1)


def role_at_least(role: str | None, minimum: str) -> bool:
    """True when `role` carries at least the privilege of `minimum`.

    An unrecognised ``minimum`` denies everyone (fails closed rather than
    silently matching nothing on a typo).
    """

    return role_rank(role) >= _ROLE_RANK.get(minimum, len(ROLE_ORDER))


def resolve_webui_role(
    realm_roles: Iterable[str], *, authenticated: bool
) -> str | None:
    """Resolve the effective WebUI role from a verified actor's realm roles.

    Args:
        realm_roles: The actor's full, unfiltered realm role set (e.g.
            ``ActorContext.roles`` — NOT the ``kg:*``-filtered
            ``GraphSession.scopes``, which has already dropped anything that
            is not a graph-authority scope, including any ``webui:*`` role).
        authenticated: Whether the caller is a verified identity at all.
            Never trust an unauthenticated caller's role, even if it were to
            somehow carry realm-role-shaped strings.

    Returns:
        One of :data:`ROLE_ORDER`, or ``None`` when unauthenticated.
    """

    if not authenticated:
        return None
    roles = frozenset(str(role) for role in realm_roles)
    explicit = {
        role[len(_WEBUI_ROLE_PREFIX) :]
        for role in roles
        if role.startswith(_WEBUI_ROLE_PREFIX)
    }
    explicit_valid = explicit & _ROLE_RANK.keys()
    if explicit_valid:
        return max(explicit_valid, key=role_rank)
    if 'kg:admin' in roles:
        return 'admin'
    if 'kg:write' in roles:
        return 'maintainer'
    if 'kg:read' in roles:
        return 'user'
    return 'reader'
