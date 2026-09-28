# Browser identity architecture

## Existing seams

Reuse `src/lib/auth.ts` and the existing identity context for display state; `src/components/views/UserManagementView.tsx`, `AdminView.tsx` and `src/lib/nav-registry.ts` for admin navigation; `src/components/ApprovalCard.tsx` and `FleetView.tsx` for approval affordances. The FastAPI host composition in `agent/agent_webui/server.py`, `oidc_session.py`, `graph_identity.py` and `graph_admission.py` already exposes identity, session and graph-admission boundaries. Audit those exact current functions before changing them. Do not add a browser-only role database or duplicate policy engine. Graph OS owns `identity.*` and elevation operations and validates the caller.

## Contract and flow

The browser obtains a redacted session descriptor `{subject, tenant, roles, mode, csrf_token?, mfa_state, session_expires_at}` from its same-origin host. The server alone holds provider or service credentials. Mutating local-auth calls require same-origin cookie plus CSRF; session rotation occurs after login, password reset and privilege change. Graph OS admin requests are typed generated-client operations with `{op, params, request_id}` and stable error code/receipt; the browser cannot choose a service principal. Mapping-rule dry run returns a preview and diagnostics, not a policy write.

Elevation flow: user submits purpose, requested scope and bounded duration; Graph OS returns an immutable request receipt. A different authorized approver sees the exact action and subject, performs step-up, then confirms or rejects. The UI displays pending/granted/revoked/expired from server receipts. Chat and A2A surfaces must use the same operation and authority; WebUI never infers approval from an HTTP success alone. Revocation invalidates cache and active controls. Browser response bodies omit secret, verifier, recovery-code hash and raw token data.

## Failure and migration

Distinguish unauthenticated, forbidden, CSRF, expired session, challenge required, step-up mismatch, stale request and provider unavailable. Keep errors uniform for username existence. Support OIDC and local modes through one session abstraction; local bootstrap refuses public bind and displays a persistent warning. When replacing token-in-cookie behavior, preserve existing OIDC return flows but rotate to opaque server-side sessions, test logout invalidation and reject a previous cookie. No unrestricted fallback mode is permitted after an identity provider outage.

## Independent checkout

Run `pnpm install --frozen-lockfile`, `uv venv --python 3.12`, `uv pip install -e '.[test]'` and the repo's `dev:server`/`dev` commands. Use disposable local identity fixtures or a test OIDC realm provisioned by the E2E job; no shared or live identity provider is required for commit checks. Browser probes run with two distinct principals and a clean profile. All required test cases are in `test-spec.md`.
