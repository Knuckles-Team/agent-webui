# Browser identity architecture

## Existing seams

Reuse `src/lib/auth.ts` and the existing identity context for display state; `src/components/views/UserManagementView.tsx`, `AdminView.tsx` and `src/lib/nav-registry.ts` for admin navigation; `src/components/ApprovalCard.tsx` and `FleetView.tsx` for approval affordances. The FastAPI host composition in `agent/agent_webui/server.py`, `oidc_session.py`, `graph_identity.py` and `graph_admission.py` already exposes identity, session and graph-admission boundaries. Audit those exact current functions before changing them. Do not add a browser-only role database or duplicate policy engine. Arbora owns `identity.*` and elevation operations and validates the caller.

## Contract and flow

The browser obtains a redacted session descriptor `{subject, tenant, roles, mode, csrf_token?, mfa_state, session_expires_at}` from its same-origin host. The server alone holds provider or service credentials. Mutating local-auth calls require same-origin cookie plus CSRF. Session rotation occurs after login, password reset and privilege change. Arbora admin requests are typed generated-client operations with `{op, params, request_id}` and stable error code/receipt. The browser cannot choose a service principal. Mapping-rule dry run returns a preview and diagnostics, not a policy write.

Elevation flow: user submits purpose, requested scope and bounded duration; Arbora returns an immutable request receipt. A different authorized approver sees the exact action and subject, performs step-up, then confirms or rejects. The UI displays pending/granted/revoked/expired from server receipts. Chat and A2A surfaces must use the same operation and authority; WebUI never infers approval from an HTTP success alone. Revocation invalidates cache and active controls. Browser response bodies omit secret, verifier, recovery-code hash and raw token data.

## Failure and migration

Distinguish unauthenticated, forbidden, CSRF, expired session, challenge required, step-up mismatch, stale request and provider unavailable. Keep errors uniform for username existence. Support OIDC and local modes through one session abstraction; local bootstrap refuses public bind and displays a persistent warning. When replacing token-in-cookie behavior, preserve existing OIDC return flows but rotate to opaque server-side sessions. Test logout invalidation and reject a previous cookie. No unrestricted fallback mode is permitted after an identity provider outage.

## Independent checkout

Run `pnpm install --frozen-lockfile`, `uv venv --python 3.12`, `uv pip install -e '.[test]'` and the repo's `dev:server`/`dev` commands. Use disposable local identity fixtures or a test OIDC realm provisioned by the E2E job. No shared or live identity provider is required for commit checks. Browser probes run with two distinct principals and a clean profile. All required test cases are in `test-spec.md`.

## Mode configuration and composition contract

Use one explicit operator configuration discriminator for no-auth, EG and OIDC. Validate the complete selected mode at startup. Missing or contradictory configuration is an error; none selects no-auth by omission. The mode doctor exposes a redacted configured/effective mode, capability scope, readiness and typed diagnostic, never credentials. Unauthenticated browser input cannot change the deployment mode. No-auth defaults to isolated loopback; broader exposure requires the deployment's explicit supported host/origin/network policy, never automatic binding relaxation.

Arbora owns producer composition and auth-mode admission. EG owns built-in identity/session authority. The browser host consumes the existing SessionBoundary or verifier seam. EG no-auth and browser no-auth are distinct configuration boundaries and must be composed intentionally. Current WebUI requires a SessionBoundary or complete JWT verifier even on loopback; current Arbora co-service composition lacks the boundary. Resolve this upstream with explicit supported anonymous admission and authenticated adapters, not a no-op callback or fabricated bearer. The same host must still enforce origin, CSRF where applicable, scoped anonymous policy, safe failures, CSP and secret redaction. Anonymous operations use explicit anonymous provenance and declared policy; capabilities that require named identity or recent authentication remain honestly unavailable.

Built-in EG mode uses Arbora served account/session operations. OIDC mode uses the configured provider's discovery/verifier and validated flow, including issuer/audience/state/nonce and mapping rules. Keycloak and Okta are interoperability targets, not separate browser authentication implementations. Keep host-owned /auth routes and built-in WebUI OIDC mutually exclusive. One component owns each route/session boundary. Never expose a service credential to browser JavaScript. No new credentials or persistent provider access are created by this specification.

Renewal is server-authoritative and bounded by configured maximum lifetime. The host updates browser-safe session descriptors while upstream Arbora/EG retain authority and revocation semantics. Coordinate renewal across concurrent calls, reject renewal after logout/revocation, and bind WebSockets/streams to the same current context. Reauthentication may preserve safe unsent drafts but cannot silently replay side effects. Mode/tenant/session changes invalidate protected queries, receipts, selected privileged objects, tool catalogs and active control. Discard late old-context responses. No-auth displays no fictional session renewal.

Dependencies: WEBUI-API-R011/R011.1 and WEBUI-APPS-R048/R050 consume this contract; Arbora identity/composition supplies the admission boundary, EG supplies local identity, and external providers supply OIDC. The deployment owner must bind concrete upstream requirement IDs and served operation versions before marking integration delivered. Source-only callback tests are insufficient: qualify installed packages and real admitted requests.

### Producer bindings and incomplete effect migration

[ARBORA-IDENTITY-R004.7, R004.4, R004.5 and R004.6](https://github.com/Knuckles-Team/arbora/tree/main/specs/identity-access) own the producer contracts. They cover mode composition, HTTP browser admission, same-owner dispatch fencing and anonymous effect migration respectively. WEBUI-IDENTITY-R003.1–R003.3/R010 consume them without claiming those candidate rows are merged or qualified. The dispatcher binds the exact request/task/caller and revalidates use-time authority after awaits. It preserves validation, policy, CAS and effect journals. A helper that only schedules work in an executor is not this dispatcher.

Current direct WebUI enhanced handlers include filesystem writes/deletes, configuration and editor operations. No-auth cannot bypass their route or effect checks. A conservative anonymous read-route policy is an interim refusal boundary, not full no-auth delivery. Direct enhanced effects remain denied until canonical operation/effect migration. Migration preserves containment, parameter/target/action binding and required confirmation. EG adapter activation and cookie WebSocket admission remain refused until their actual caller/use-time and WebSocket contracts are qualified. Source regressions or an inactive fence do not close login, renewal, streaming, writes or full three-mode acceptance.

## Amendment: 2026-10-23 explicit deployment identity modes

Extend WEBUI-IDENTITY-R003 with operator-selected `none`, `eg` and `oidc`
serving modes. The default remains authenticated. Missing or failed authenticated
configuration never selects `none`. The explicit no-auth listener is loopback
only. It binds an unauthenticated request actor with no credential or grant.
Arbora remains the authority for invoked operations. Host, origin, payload and
WebMCP confirmation/attendance checks are not disabled. EG mode requires the
host-owned session boundary; external OIDC retains complete verifier checks.
Source-level contracts do not qualify a deployed issuer, browser login or EG
session revocation. Those require installed-stack and browser acceptance.

### Anonymous policy and shared dispatch qualification

The initial exact read-route policy defaults empty. Direct enhanced workspace,
configuration and browser-control handlers remain denied even when named in
that interim policy. Mutations and WebSockets still require existing authority.
This is partial scaffolding, not the final no-auth product. Full no-auth needs
host-owned operation/effect policy, containment and confirmation through the
same dispatcher for UI and WebMCP. Do not turn anonymous requests into a
fabricated authenticated actor or kg:* grant. See the Arbora identity-access
plan's shared admission/invocation contract; EG integration requires exact
caller binding and a current-authority fence after asynchronous verification.

The shared caller remains opaque and request/task-bound. Both host callbacks
must belong to the exact same authority instance. Confirmation covers validated
parameters, resource/tenant/graph targets and immutable action digest. The
frontend never serializes that authority into browser state or reconstructs it
from claims. Streaming, task hops, cancellation and duplicate invocation tests
must prove lifetime/isolation; native effect CAS/consume-once remains upstream.

### Narrow source ownership

This candidate builds on the published identity definitions in PR 125. Source delivery binds R003.1.1, R003.2.1 and R003.3.1 only. The corresponding .2 children retain all installed, provider and native acceptance. Parent mode rows remain incomplete; R010 is not delivered by source configuration refusal tests.

### Explicit zero-effect local browser port

The factory may accept a nominal Arbora-owned local browser port in none mode.
Only its fixed WebSocket path bypasses the ordinary no-grant route gate.
The anonymous actor and outer Host and security middleware remain unchanged.
The optional port is imported lazily; absent mode keeps standalone compatibility.
No session-boundary, anonymous read policy or operation admission is widened.
