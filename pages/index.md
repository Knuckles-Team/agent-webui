<section class="site-hero" aria-labelledby="webui-hero-title">
  <p class="site-hero__eyebrow">Operator experience for GraphOS</p>
  <h1 class="site-hero__title" id="webui-hero-title">See the work. Guide the agent. Explore the evidence.</h1>
  <p class="site-hero__summary">
    Agent WebUI brings conversations, governed actions, workflows, fleet activity,
    and epistemic knowledge into one role-aware browser workspace.
  </p>
  <div class="site-hero__actions">
    <a href="start/">Start locally</a>
    <a href="architecture/">Understand the system</a>
    <a href="deployment/">Operate it</a>
  </div>
</section>

![The Agent WebUI Atlas workspace presents guided knowledge entry points and expert query tools.](assets/screenshots/atlas-workspace.png)

## One interface, explicit authority

<div class="site-ownership">
  <div class="site-ownership__grid">
    <article class="site-ownership__item">
      <span class="site-ownership__label">This repository owns</span>
      <div class="site-ownership__value">Browser presentation, accessible route composition, local interaction state, and the WebUI FastAPI boundary.</div>
    </article>
    <article class="site-ownership__item">
      <span class="site-ownership__label">GraphOS owns</span>
      <div class="site-ownership__value">Public routing, verified identity, runtime policy, fleet supervision, and composition of this UI.</div>
    </article>
    <article class="site-ownership__item">
      <span class="site-ownership__label">The platform owns elsewhere</span>
      <div class="site-ownership__value">Agent behavior lives in agent-utilities, durable knowledge in epistemic-graph, and source effects in connector services.</div>
    </article>
  </div>
</div>

## Choose your path

<div class="site-card-grid">
  <article class="site-card">
    <h3 class="site-card__title">Try it</h3>
    <p class="site-card__body">Install the GraphOS WebUI integration, start one local composition, and open the browser workspace.</p>
    <p><a href="start/">Open the start guide →</a></p>
  </article>
  <article class="site-card">
    <h3 class="site-card__title">Understand it</h3>
    <p class="site-card__body">Follow one request from the browser through GraphOS to agents, knowledge, and connector effects.</p>
    <p><a href="ecosystem/">See how the ecosystem fits →</a></p>
  </article>
  <article class="site-card">
    <h3 class="site-card__title">Operate it</h3>
    <p class="site-card__body">Apply identity, origin, host, content-security, image-promotion, and rollback controls.</p>
    <p><a href="deployment/">Open deployment operations →</a></p>
  </article>
</div>

## What operators can do

- Hold agent conversations with sources, tool activity, and approval prompts.
- Build workflows and inspect active sessions, goals, schedules, and fleet health.
- Use Atlas to move between graph, RDF, schema, object, table, document, code,
  and memory views.
- Discover MCP Apps and connector capabilities through the GraphOS boundary.
- Apply the same role-aware navigation and server authorization model across
  the complete workspace.

## Request flow

<ol class="site-flow">
  <li class="site-flow__step">
    <h3 class="site-flow__title">Interact</h3>
    <p class="site-flow__body">The operator chats, explores knowledge, approves an action, or runs a workflow.</p>
  </li>
  <li class="site-flow__step">
    <h3 class="site-flow__title">Govern</h3>
    <p class="site-flow__body">The same-origin WebUI host and GraphOS verify identity, route the request, and apply policy.</p>
  </li>
  <li class="site-flow__step">
    <h3 class="site-flow__title">Execute</h3>
    <p class="site-flow__body">agent-utilities runs agent behavior while epistemic-graph and connector services perform their owned operations.</p>
  </li>
  <li class="site-flow__step">
    <h3 class="site-flow__title">Observe</h3>
    <p class="site-flow__body">Typed events, evidence, and governed results return to the browser without service credentials crossing the boundary.</p>
  </li>
</ol>

## Explore the interface

- [Atlas workspace](atlas.md) — guided and expert knowledge exploration.
- [Capability Workbench](capability-workbench.md) — discover, preflight, invoke,
  and follow governed capabilities.
- [Agents and events](agents.md) — event types, routing, and graph activity.
- [Feature reference](features.md) — browser configuration and WebUI-owned API surfaces.
- [Ecosystem map](ecosystem.md) — the five repositories and their exact ownership.
