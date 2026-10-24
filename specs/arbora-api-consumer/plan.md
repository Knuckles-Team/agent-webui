# API consumer architecture

## Current and target wiring

Current WebUI calls are concentrated in `src/lib/api.ts`, `src/lib/admin-api.ts`, `src/lib/atlas/`, `src/lib/webmcp/`, and the FastAPI `agent/agent_webui/api_extensions.py` facade. The host is assembled in `agent/agent_webui/server.py`; `src/lib/nav-registry.ts` is the route authority. Audit every current browser route and host handler before deleting it. Target path: browser → same-origin WebUI session host → generated Arbora `/api/v1` client → Arbora operation registry → authorized owning service. Arbora owns credentials, operation schema, scope, effect gate, audit and stable errors; the WebUI owns rendering, interaction and browser-safe session forwarding.

Generate the client into `src/lib/arbora-api/` from a pinned published schema with a repeatable command and checked-in lock/digest. The adapter accepts typed operation name and params, supplies correlation/request ID and caller context through the host, validates error envelopes, and returns a discriminated success/error result. It must not synthesize scopes, bypass server policy or accept arbitrary URL targets from browser input. For effects, the response carries a `plan_ref`, effect class and required confirmation/step-up; confirmation posts the exact unmodified plan reference and binds it to the current principal/session. Denial codes and database codes remain intact for display and debugging without leaking sensitive detail.

## CI support amendments

### 2026-10-11: run typed lint in one hook process

The shared host gate runs typed lint before consumer tests. The current
filename hook can start concurrent ESLint processes. Each process starts
its own TypeScript project service. Run this hook serially to avoid that
repeated work. Keep the command, filename filters, stages and failure policy.
Do not change the full manual lint check. Check the selected filenames and
hook contract; measure any timing change in hosted CI before claiming a gain.
This CI change does not establish acceptance of a product requirement.

## Cutover sequence

1. Freeze a route census with classifications: UI-local, session/protocol, generated Arbora operation, and retire. Save the census with this spec when implementation starts.
2. Introduce the generated client and prove read/error/auth parity for one route family, then migrate decisions/apps/WebMCP, ontology/graph/Atlas/object-set, and remaining domain families.
3. Move server-side adapters into the same operation path. Delete retired `api_extensions.py` domain blocks and AU-internal imports only after each family's regression tests pass. Do not keep a hidden fallback to the old path.
4. Add an architecture gate that rejects new browser-domain endpoints in the host and direct AU-internal imports. UI-local endpoints must be allowlisted with owner and reason.

## Compatibility and failure

The `/api/v1` version and schema digest are visible to the client. A version mismatch fails with a concise upgrade state. No call is sent with guessed fields. Preserve pagination cursors, result shapes and cancellation. Timeouts, forbidden, conflict, validation and unavailable responses remain distinguishable. Streaming uses existing authenticated browser transport and the same caller. Cancellation is idempotent. Never log request bodies carrying prompts, secrets or tenant data. For fresh checkout, install `pnpm`/`uv` dependencies as in `AGENTS.md`. Use a checked-in schema fixture or a locally provisioned Arbora service to regenerate and test without a shared deployment.

## Amendments

### 2026-10-11: engine wheel integrity for host tests

The host tests, including `WEBUI-API-R005`, still import the AU numeric layer.
The existing `--engine-wheel` bootstrap option keeps using the rolling
`engine-main` release. Before installation, bootstrap must check the downloaded
wheel against the selected GitHub asset's SHA-256 digest. A missing digest or
mismatched download must stop bootstrap. After installation, bootstrap must
import `agent_utilities.numeric` to run its existing certified-kernel check.
Delete any old receipt before sync changes the environment. After the
certification check passes, store the release ID, asset ID, source target and
digest in the virtual environment. The source target is release metadata; it
does not attest the compiled source. This receipt identifies the tested artifact without
adding a fixed source pin. Fixture tests cover matching and invalid downloads.
Real host tests must still pass before runtime acceptance.

CI support source for `WEBUI-API-R005` is
[`d3bf9a9651c70688dd19ade62b45dc2897d9fa9a`](https://github.com/Knuckles-Team/agent-webui/commit/d3bf9a9651c70688dd19ade62b45dc2897d9fa9a).
Seven fixture tests pass. Native host acceptance remains pending. This change
does not add a test binding or claim new runtime verification for the row.

### 2026-10-11: current pull-request gate takes precedence

A newer pull-request revision must cancel the older run in the same release
concurrency group. This prevents obsolete revisions from delaying the current
host checks, including `WEBUI-API-R005`. Push and manual release runs must
keep the existing no-cancellation policy. The group key, gate timeouts and
test scopes stay unchanged. Event contract tests cover PR cancellation and
non-PR preservation. They do not establish native host acceptance.

### 2026-10-11: test evidence before pre-push metadata checks

The gates job must run its existing test steps after bootstrap and commit
hooks, but before pre-push hooks. This lets selected tests produce real
execution evidence even when the later spec trailer check blocks delivery.
Keep every command, test scope, failure gate and timeout unchanged. Scope
selection still controls which tests run; ordering alone does not establish
`WEBUI-API-R005` acceptance. Its real tests must run before adding a binding.

The existing error-code test file now checks the exact length boundary:
64 uppercase characters remain in the log; 65 produce `error_code=none`.
These tests import the real host module. They have no new spec binding until
hosted execution passes. The existing scope resolver selects this changed
test file without a second test list or a broader scope override.

### 2026-10-11: check the real host after wheel installation

The host imports AU's Agent Library constants and store. The old AU pin
predates that module. Parent PR #80 source `23abf3493a114389e101efbd0190382dcef30d64`
updates AU to `f0cd9fd58d168f2c094787b08eab0ef4e06303aa` and the connector SDK
to `8e2d7c50896a9e416ec76e53c4a9a585cc5f4d28`, with a regenerated lockfile.
Merge that repair without changing its immutable pins or dependency lock.
Import the real host module after numeric certification during wheel bootstrap.
Write the receipt only after both imports pass. This check enables the existing
host tests, including `WEBUI-API-R005`; it does not establish their acceptance.
Do not replace the public owner API or hide an import failure.

### 2026-10-11: bind the tested failure-log tests

Hosted job [38129639497](https://github.com/Knuckles-Team/agent-webui/actions/runs/38129639497)
tested source `1684efea0e6d85f720803a6b729bdc2ee2b01a38` with the real host
and certified engine wheel. At 10:00:11 UTC, all five tests in
`tests/test_log_failure_error_code.py` passed. All 19 selected tests passed.
The tests cover typed and plain codes, missing or malformed codes, message
redaction, and the 64/65-character boundary. Bind these tested tests to
`WEBUI-API-R005` without changing their semantics. Generate the delivery
record after publishing this source. This evidence covers failure logging;
it does not establish acceptance of the other consumer requirements.

### Host composition without an engine (WEBUI-API-R011.1)

The WebUI holds no graph engine. A host composes its own routes on the real
factory through `application_composer`. Graph data reaches the WebUI only
through Arbora served operations in `host.py`. Host composition owns agent
and session lifecycle. Injection does not create identity or authority.

## Responsive workspace route/action census consumer

WEBUI-API-R003.2 remains the owner of populated domain-route census data and its CI classifier. WEBUI-APPS-R045 consumes that classification for each visible action: generated Arbora operation, explicitly browser-local behavior or unavailable capability. A redesigned button or WebMCP tool must not silently fall back to a host-owned domain implementation. R007 preview/confirmation/step-up, R011 identity/stream/cancel and R011.1 composed-host refusal remain unchanged. Complete the API census before claiming full capability coverage; UI route presence is not evidence that a backend operation is served.

## Catalog and source discovery use graph queries

Catalog, glossary, stewardship, lineage, prompt-candidate and virtual-source questions use Arbora `ask`/`find` intent routing to `query.nl`, or typed `query.uql` for programmatic clients. Do not introduce or regenerate a bespoke `catalog.search`, `glossary.list/get`, `stewardship.list/get`, `catalog.lineage`, `catalog.prompt_candidates` or `query.sources` operation family. Arbora owns intent routing and the governed source executor; EG owns ontology, relevance and graph query semantics. This follows merged [Arbora #432](https://github.com/Knuckles-Team/arbora/pull/432), ARBORA-OPS-R855.1/R855.4–R855.6 and ARBORA-FLEET-R043.2/R043.3/R043.7. The related [EG #739](https://github.com/Knuckles-Team/epistemic-graph/pull/739) correction owns EG-TYPED-PACKS-R106/R108 and EG-DECISION-ENGINE-R814; its still-open specification is not a delivered producer receipt. The route/action census binds these query operations, preserving typed tenant/purpose, pagination, refusal and cancellation behavior. A local component app catalog or dashboard save contract does not imply a new metadata catalog read API.

## Amendment 2026-10-24: public execution adapter

R011.2 retains its original conversation and root-task identity contract and recorded source evidence.
R011.3 adds node-bound public execution records and capability projection without replacing that contract.

Current path: `Chat.tsx` -> host model -> `orchestrator_model.py:220` `_run_turn` -> `agents.run`.
`_reply_stream` at line 260 waits for `_run_turn`, then yields final text and identity/usage metadata.
It does not currently yield rich summary, tool or child-transcript parts from the execution producer.
Existing reasoning and tool widgets therefore do not prove live orchestration visibility.

Extend that adapter and the existing typed browser client only after the generated producer contract is available.
`ARBORA-OPS-R021.4.8` owns graph snapshots and updates; `ARBORA-OPS-R021.4.9` owns authorized records and capabilities.
`ARBORA-RELEASE-R003.4.12` and `ARBORA-RELEASE-R003.4.13` own distinct active-message and completed-continuation effects.
Use their registered operations and generated types; this specification does not assign speculative endpoint names.

Preserve existing public replay v1 semantics and decoder invariants.
Version or capability-negotiate graph, lineage and transcript projections separately; refuse unsupported versions without reinterpreting old events.
Keep root request `task_id` separate from event-local `task_id`.
Preserve structured `(run_id, node_kind, local_id)` keys and explicit owner, context and target bindings.
A trace/span identifier or an agent name must never become a conversation target.
Preserve snapshot schema version, completeness, covered cursor and per-run replay cursors without synthesizing global order.
Capabilities default false when absent or unsupported; browser availability never replaces host/backend authorization.
The adapter must reject mismatched identities and unknown schema versions before forwarding protected records or controls.

Project only public summaries, redacted tool activity and authorized conversation records into the existing parts rendering path.
Preserve event identity for deduplication and explicit fold choices.
Private reasoning, unknown fields and service credentials must not enter browser parts, URLs, logs or local persistence.
A missing or denied producer must remain unavailable; legacy text-only replies must continue without invented graph data.
Keep installed-provider proof separate from pure mapping, mounted-widget and synthetic browser fixtures.
