"""Immutable deployment identity selection, never a request-controlled fallback."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class AuthMode(StrEnum):
    """The operator's explicit identity owner; legacy defaults stay protected."""

    REQUIRED = 'required'
    NONE = 'none'
    EG = 'eg'
    OIDC = 'oidc'


def resolve_auth_mode(value: str | None) -> AuthMode:
    """Reject unknown settings rather than accidentally enabling anonymous access."""
    try:
        return AuthMode('required' if value is None else value)
    except ValueError:
        raise ValueError(
            'WebUI auth mode must be required, none, eg, or oidc'
        ) from None


def validate_auth_mode(
    mode: AuthMode,
    *,
    loopback: bool,
    has_verifier: bool,
    has_boundary: bool,
    has_browser_sso: bool,
    boundary_mode: str | None = None,
) -> None:
    """Validate composition without creating credentials or changing settings."""
    if mode is AuthMode.NONE:
        if not loopback:
            raise RuntimeError(
                'Explicit WebUI no-auth mode requires a loopback listener'
            )
        if has_verifier or has_boundary or has_browser_sso:
            raise RuntimeError('WebUI no-auth mode conflicts with configured identity')
    if mode is AuthMode.EG and (not has_boundary or boundary_mode != 'eg'):
        raise RuntimeError(
            'WebUI EG mode requires the host session boundary identified as eg'
        )
    if mode is AuthMode.OIDC and (
        has_boundary or not has_verifier or not has_browser_sso
    ):
        raise RuntimeError(
            'WebUI OIDC mode requires its complete verifier and browser SSO, not an EG boundary'
        )


@dataclass(frozen=True)
class AnonymousReadPolicy:
    """Explicit exact read routes selected by trusted host composition.

    No wildcard, mutation, direct workspace/configuration access or attended
    browser control is admitted. Expanding those capabilities requires their
    upstream anonymous policy/confirmation contract, not a fabricated grant.
    """

    routes: frozenset[str] = frozenset()

    def __post_init__(self):
        routes = self.routes
        if type(routes) is not frozenset or any(
            type(path) is not str
            or not path.startswith('/api/')
            or any(char in path for char in '*{}?%#')
            or '..' in path
            for path in routes
        ):
            raise ValueError('Anonymous read policy requires exact API paths')

    def allows(self, method: str, path: str, *, admin: bool) -> bool:
        reserved = (
            '/api/enhanced',
            '/api/files',
            '/api/download',
            '/api/config',
            '/api/config-files',
            '/api/editor-context',
            '/api/browser',
            '/api/mcp',
            '/api/identity',
            '/api/secrets',
        )
        return (
            not admin
            and method in {'GET', 'HEAD'}
            and path in self.routes
            and not any(
                path == prefix or path.startswith(prefix + '/') for prefix in reserved
            )
        )
