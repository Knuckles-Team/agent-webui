# Capability Workbench

Agent WebUI mounts one capability workbench beside the persistent assistant on
every route. `Ctrl/Cmd+K` opens it without navigating away from the active
workspace. The workbench is generated from live Agent Utilities contracts, so a
new registered action becomes discoverable without adding a static React page.

## Execution flow

1. `GET /api/capabilities` supplies the searchable catalog, availability,
   action schemas, side-effect declarations, render hints, and the normative
   governed-invoke contract. Legacy REST twins are labeled display-only and
   never treated as executable frontend routes.
2. Selecting an item refreshes its descriptor with
   `GET /api/capabilities/{capability_id}`.
3. The selected action's JSON Schema generates the input form. Fields with
   matching names are prefilled from the typed page context: current selection,
   filters, time range, route, and view. Every inferred value stays visible and
   editable.
4. `POST /api/capabilities/{capability_id}/preflight` receives only `action`,
   `inputs`, and the selected `target`. The browser cannot supply an actor
   identity. Preflight is a non-authoritative preview; identity and policy are
   evaluated again at execution.
5. Mutating and unknown-side-effect actions require explicit confirmation.
   Denied, invalid, and unavailable actions remain disabled. An eligible queued
   action is labeled **Request approval**, not executable.
6. The client submits every execution to the governed
   `POST /api/capabilities/{capability_id}/invoke` boundary. It never constructs
   or posts descriptor routes. The backend applies the action's request encoding,
   resolves authenticated identity, rechecks policy, emits run events, and then
   dispatches the registered tool.
7. A `202 approval_required` response becomes a pending state. After an
   authorized surface grants it, **Resume approved action** resubmits the exact
   action, inputs, target, approval ID, and server-bound run/session IDs. Editing
   the proposal discards that pending state.
8. An accepted invocation returns `202 running`; the HTTP request does not wait
   for tool completion. The workbench immediately follows the bound run and
   passes a later `tool_result` event through the same renderer registry.

## Results and runs

The renderer registry currently provides table, evidence, graph-friendly, and
JSON renderers. Unsupported specialized hints degrade to an inspected JSON
payload rather than inventing a visualization. Canonical `{status, result}`
envelopes are unwrapped for display while the original response remains
available for run-ID detection.
Sensitive tool results stay in their canonical redacted-metadata form. The
generic renderer never follows a one-time claim route automatically and never
stores revealed secret material.

The Runs surface lists newest-first lifecycle summaries from `GET /api/runs`,
including running, completed, failed, cancelled, and waiting-for-input states.
Any run can be replayed from `GET /api/runs/{run_id}/events` and followed through
the same route's SSE mode. The stream parser consumes arbitrary named events,
deduplicates by canonical event ID, and resumes after the last sequence. Replay
paginates by that sequence cursor into a bounded browser timeline; live follow
closes as soon as a terminal event arrives. A canonical `stream_reset` also
closes follow and asks the operator to replay the retained window instead of
silently skipping lost events.
`session_id` is the stable conversation/concurrency key; `run_id` uniquely
identifies one execution. The inspector never substitutes one for the other: it
discovers runs from the run list, an invocation response, or the immediate
`run_started` event and only uses `session_id` as a list filter/display field.

## Failure semantics

Catalog, descriptor, preflight, invocation, recent-run, summary, replay, and
follow failures are rendered independently. An unavailable or degraded
capability remains visible with the live reasons and missing preconditions. No
demo result, simulated policy decision, or fabricated run is substituted.
All API and event requests propagate same-origin browser credentials. A `401` or
`404` remains an explicit unavailable state; the client neither retries with a
frontend-supplied identity nor silently changes run IDs.

The machine-readable coverage ledger is
[`capability-coverage.json`](capability-coverage.json). Dedicated workspaces are
declared `native`; every other live capability receives the generated workbench
by default.

## Extending the shell

- Add a native workspace only when it materially improves the generic form or
  result experience, then record its capability ID and route in the coverage
  ledger.
- Add a renderer by registering a component in `ResultRenderer.tsx`; it must
  validate payload shape and fall back to JSON when the declared shape is not
  present.
- Extend context prefilling in `capability-forms.ts` with deterministic field
  mappings. Never hide inferred mutation targets from the form.
- Keep execution on the governed capability-invoke route and activity on the
  canonical run event contract. Frontend code must not call descriptor routes or
  open the graph store directly.
