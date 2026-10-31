# How the ecosystem fits

The repositories form one runtime. Each owns one kind of authority, and
Overstory presents those capabilities without duplicating them.

[![Knuckles-Team runtime architecture showing Overstory, Arbora, Meristem, Medulla, and Scion SDK in their owned positions.](https://raw.githubusercontent.com/Knuckles-Team/medulla/main/docs/assets/runtime-architecture.svg)](https://knuckles-team.github.io/.github/architecture/#webui)

[Explore the live architecture](https://knuckles-team.github.io/.github/architecture/#webui)

## Component ownership

<div class="site-card-grid">
  <article class="site-card">
    <h3 class="site-card__title">Overstory</h3>
    <p class="site-card__body">The operator experience: browser presentation, local interaction state, accessible navigation, and a same-origin server boundary.</p>
    <p><a href="https://knuckles-team.github.io/overstory/">Documentation →</a></p>
  </article>
  <article class="site-card">
    <h3 class="site-card__title">Arbora</h3>
    <p class="site-card__body">The public runtime gateway: MCP, REST, A2A, identity, policy, fleet supervision, and Overstory composition.</p>
    <p><a href="https://knuckles-team.github.io/arbora/">Documentation →</a></p>
  </article>
  <article class="site-card">
    <h3 class="site-card__title">Meristem</h3>
    <p class="site-card__body">The in-run harness: applies the decisions it receives and holds no store.</p>
    <p><a href="https://knuckles-team.github.io/meristem/">Documentation →</a></p>
  </article>
  <article class="site-card">
    <h3 class="site-card__title">Medulla</h3>
    <p class="site-card__body">One engine and one server executable: graph, SQL, RDF, vector, time, blobs, reasoning, provenance, and transactions.</p>
    <p><a href="https://knuckles-team.github.io/medulla/">Documentation →</a></p>
  </article>
  <article class="site-card">
    <h3 class="site-card__title">Scion SDK</h3>
    <p class="site-card__body">The governed source boundary: typed discovery, reads, ingestion records, server registration, and write-back contracts.</p>
    <p><a href="https://knuckles-team.github.io/scion-sdk/">Documentation →</a></p>
  </article>
</div>

## One request, one owner at every step

<ol class="site-flow">
  <li class="site-flow__step">
    <h3 class="site-flow__title">Present</h3>
    <p class="site-flow__body">Arbora collects the operator's intent and renders typed events and results.</p>
  </li>
  <li class="site-flow__step">
    <h3 class="site-flow__title">Admit</h3>
    <p class="site-flow__body">Arbora verifies identity, applies runtime policy, and selects the owned service boundary.</p>
  </li>
  <li class="site-flow__step">
    <h3 class="site-flow__title">Act</h3>
    <p class="site-flow__body">Meristem applies decisions in the run; connector services perform authorized external effects.</p>
  </li>
  <li class="site-flow__step">
    <h3 class="site-flow__title">Commit</h3>
    <p class="site-flow__body">Medulla validates and records durable state, evidence, provenance, and receipts.</p>
  </li>
</ol>

## What Overstory consumes

| Surface | Authority | Overstory responsibility |
|---|---|---|
| Chat, sessions, goals, workflows, prompts, skills | Meristem through Arbora | Render state, collect input, and surface approvals |
| Graph, RDF, schema, objects, tables, code, documents, memories | Medulla through Arbora | Provide guided and expert exploration without storing a second truth |
| MCP Apps, connector catalogs, source operations | Arbora and connector services | Discover typed capabilities and render governed invocation results |
| Identity, roles, request policy, fleet health | Arbora | Apply the server decision to navigation and interaction controls |

The browser never receives an Arbora service credential. The Overstory FastAPI host
performs same-origin delegation using the verified request context injected by
Arbora, and every downstream component remains authoritative only for its own
contract.

## Shared language

Use the [ecosystem glossary](glossary.md) for the canonical meaning of Arbora,
the agent control plane, the knowledge engine, connector boundary, MCP, A2A,
OWL, RDF, SHACL, and UQL.
