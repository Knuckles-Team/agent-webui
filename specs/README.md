# agent-webui specifications

These specs follow the ecosystem [spec standard](https://github.com/Knuckles-Team/pipelines/blob/main/reference/spec-standard.md): one owning spec per capability, extend an existing spec before creating one, audits and reviews land in the owning spec, one ID and title form, one file set. The `spec-standard` gate enforces it.

This tracked `specs/` directory is the public build contract for **WEBUI** owned work. Every
spec must contain the behavior, architecture, interfaces, tests, quality gates, and acceptance
criteria needed to implement it from this repository. External program notes may inform a draft,
but no private document or local workspace path is required to build or check a public spec.
Delivery status is recorded here with exact merged revision and test evidence.

## Structure

Create `specs/<stable-id>/` with `spec.md` (user outcome, requirements, acceptance), `plan.md`
(architecture, reuse, interfaces, live wiring, decisions), `test-spec.md` (positive, negative,
integration, quality and release proof), `tasks.md` (ordered implementation and verification),
`requirements.md` (one entry per requirement ID this spec owns, defining what each ID means and
the proof that closes it), and `status.json` (machine-readable delivery, acceptance, and public
receipts). `status.json` carries a `requirements` array with one entry per requirement ID,
each with its own `delivery_state` and evidence, in addition to the spec-level
`delivery_state`/`acceptance_state`.
Start from [`_template/`](_template/). Keep status and evidence explicit; a planned or tested item
is not a landed item. Put durable evidence links in the spec directory, never local scratch output.
This follows a specify/plan/tasks flow with an explicit test contract. The tracked [constitution](../.specify/memory/constitution.md) records this repository's governing principles.

Each spec must name its stable ID and sole owner. Cross-repository work links the other owners'
public specs by stable ID and GitHub URL; each repository documents the complete contracts and
acceptance it owns. Designs must inventory existing code and reuse the legal
owner and live wiring before proposing new components. Include CCCC, jscpd, dupehound, KISS,
language-native and repo release gates where applicable, with exact pass evidence and a
no-duplicate-authority check.

## States

States are `SPECIFIED`, `LANDED`, and `VERIFIED`. The generator sets them. See the [spec standard](https://github.com/Knuckles-Team/pipelines/blob/main/reference/spec-standard.md#states).

## Arbora owner map

| Prefix | Repository specs | Responsibility |
|---|---|---|
| `EG` | [epistemic-graph](https://github.com/Knuckles-Team/epistemic-graph/tree/main/specs) | Rust database, graph compute, ontology, governed ingestion, durable records and clients |
| `SDK` | [agent-connector-sdk](https://github.com/Knuckles-Team/agent-connector-sdk/tree/main/specs) | connector control, transport, manifests, certification, governed effects |
| `AU` | [agent-utilities](https://github.com/Knuckles-Team/agent-utilities/tree/main/specs) | agent orchestration and control workflows |
| `ARBORA` | [arbora](https://github.com/Knuckles-Team/arbora/tree/main/specs) | serving composition, fleet, gateway, A2A, deployment operations |
| `WEBUI` | [agent-webui](https://github.com/Knuckles-Team/agent-webui/tree/main/specs) | browser presentation and interaction |
| `RM` | [repository-manager](https://github.com/Knuckles-Team/repository-manager/tree/main/specs) | repository discovery, worktrees, source control and execution |

## Contributions

Read this repository's `AGENTS.md` and any contribution guide. Propose `spec.md` first, resolve
architecture and test details in `plan.md` and `test-spec.md`, then implement `tasks.md` in a
dedicated branch or worktree. Link the PR to spec IDs and update evidence and status only when the
corresponding gates actually pass. Use the [universal-skills spec-generator](https://github.com/Knuckles-Team/universal-skills/tree/main/universal_skills/development/spec-generator),
[spec-verifier](https://github.com/Knuckles-Team/universal-skills/tree/main/universal_skills/development/spec-verifier),
and [task-planner](https://github.com/Knuckles-Team/universal-skills/tree/main/universal_skills/development/task-planner)
and the [arbora-development](https://github.com/Knuckles-Team/arbora/blob/main/arbora/skills/arbora-development/SKILL.md)
bootstrap skill, together with the [SDD full lifecycle](https://github.com/Knuckles-Team/universal-skills/tree/main/universal_skills/development-workflows/sdd-full-lifecycle) workflow.

## Local specifications

- [`FIN-UI`](finance-asset-manager/spec.md) — FIN-UI-R001 and FIN-UI-R002 Markets and shared chart; specified, implementation unverified.
- [`WEBUI-DESIGN`](browser-design-system/spec.md) — WEBUI-DESIGN-R001 accessible UI primitives, visual contracts and design-guidance assimilation.
- [`WEBUI-DECIDE`](decision-evidence/spec.md) — WEBUI-DECIDE-R001 calibration dashboard and governed decision explanation.
- [`WEBUI-API`](arbora-api-consumer/spec.md) — WEBUI-API-R001–WEBUI-API-R004 generated client and domain-family migration.
- [`WEBUI-APPS`](arbora-app-surface/spec.md) — application routes and integrated navigation.
- [`WEBUI-IDENTITY`](identity-access/spec.md) — authentication state and tenant-safe browser behavior.
- [`delete-past-chats.md`](delete-past-chats.md), [`update-color-scheme.md`](update-color-scheme.md), and [`update-tools-dropdown.md`](update-tools-dropdown.md) are existing brief feature drafts. Preserve them; expand to the shared feature directory format when resumed.
- [`WEBUI-DASH`](agent-dashboards/spec.md) — user and agent built dashboards with WebMCP tools, arbora queries and arbora saves.
