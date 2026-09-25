# GraphOS

<p align="center">
  <img src="docs/assets/brands/graph-os-logo-v1.png" alt="GraphOS logo" width="160" />
</p>

<p align="center">
  <strong>The browser workspace for governed agents, workflows, and knowledge in Graph OS.</strong><br>
  <sub>Conversations · approvals · workflows · fleet activity · Atlas knowledge views</sub>
</p>

<p align="center">

[![PyPI - Version](https://img.shields.io/pypi/v/graph-os-webui)](https://pypi.org/project/graph-os-webui/)
[![Build](https://github.com/Knuckles-Team/graph-os-webui/actions/workflows/release.yml/badge.svg)](https://github.com/Knuckles-Team/graph-os-webui/actions/workflows/release.yml)
[![Documentation](https://img.shields.io/badge/docs-GitHub%20Pages-526cfe)](https://knuckles-team.github.io/graph-os-webui/)
[![GitHub license](https://img.shields.io/github/license/Knuckles-Team/graph-os-webui)](LICENSE)
[![Docs build](https://github.com/Knuckles-Team/graph-os-webui/actions/workflows/advisory.yml/badge.svg?branch=main)](https://github.com/Knuckles-Team/graph-os-webui/actions/workflows/advisory.yml)
[![PyPI - Downloads](https://img.shields.io/pypi/dd/graph-os-webui)](https://pypi.org/project/graph-os-webui/)
[![PyPI - License](https://img.shields.io/pypi/l/graph-os-webui)](https://pypi.org/project/graph-os-webui/)
[![PyPI - Wheel](https://img.shields.io/pypi/wheel/graph-os-webui)](https://pypi.org/project/graph-os-webui/)
[![PyPI - Implementation](https://img.shields.io/pypi/implementation/graph-os-webui)](https://pypi.org/project/graph-os-webui/)
[![GitHub Repo stars](https://img.shields.io/github/stars/Knuckles-Team/graph-os-webui)](https://github.com/Knuckles-Team/graph-os-webui/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/Knuckles-Team/graph-os-webui)](https://github.com/Knuckles-Team/graph-os-webui/forks)
[![GitHub contributors](https://img.shields.io/github/contributors/Knuckles-Team/graph-os-webui)](https://github.com/Knuckles-Team/graph-os-webui/graphs/contributors)
[![GitHub last commit (by committer)](https://img.shields.io/github/last-commit/Knuckles-Team/graph-os-webui)](https://github.com/Knuckles-Team/graph-os-webui/commits/main)
[![GitHub pull requests](https://img.shields.io/github/issues-pr/Knuckles-Team/graph-os-webui)](https://github.com/Knuckles-Team/graph-os-webui/pulls)
[![GitHub closed pull requests](https://img.shields.io/github/issues-pr-closed/Knuckles-Team/graph-os-webui)](https://github.com/Knuckles-Team/graph-os-webui/pulls?q=is%3Apr+is%3Aclosed)
[![GitHub issues](https://img.shields.io/github/issues/Knuckles-Team/graph-os-webui)](https://github.com/Knuckles-Team/graph-os-webui/issues)
[![GitHub top language](https://img.shields.io/github/languages/top/Knuckles-Team/graph-os-webui)](https://github.com/Knuckles-Team/graph-os-webui)
[![GitHub language count](https://img.shields.io/github/languages/count/Knuckles-Team/graph-os-webui)](https://github.com/Knuckles-Team/graph-os-webui)
[![GitHub repo size](https://img.shields.io/github/repo-size/Knuckles-Team/graph-os-webui)](https://github.com/Knuckles-Team/graph-os-webui)
[![GitHub repo file count (file type)](https://img.shields.io/github/directory-file-count/Knuckles-Team/graph-os-webui)](https://github.com/Knuckles-Team/graph-os-webui)

</p>

<p align="center">
  <a href="https://knuckles-team.github.io/graph-os-webui/">Documentation</a> ·
  <a href="https://knuckles-team.github.io/graph-os-webui/features/">Capabilities</a> ·
  <a href="https://knuckles-team.github.io/graph-os-webui/architecture/">Interfaces</a> ·
  <a href="https://knuckles-team.github.io/graph-os-webui/status/">Status</a>
</p>

![The GraphOS Atlas workspace presents graph, object, schema, data, document, and memory entry points in one browser surface.](docs/assets/screenshots/atlas-workspace.png)

## Overview

GraphOS is the browser workspace composed by Graph OS. It brings agent
conversations, approvals, workflows, fleet activity, and Epistemic Graph
exploration into one React application. Its FastAPI host keeps privileged
credentials and gateway delegation on the server side.

| GraphOS owns | Other components own |
|---|---|
| Browser presentation, local interaction state, accessible route composition, and the FastAPI boundary | Graph OS owns public routing, identity, policy, and fleet supervision; Agent Utilities owns agent behavior; Epistemic Graph owns durable knowledge; connector services own external-system effects |

Current package Version: 2.6.2.

## Key capabilities

- Stream agent responses with sources, governed tool activity, and approval prompts.
- Build and run workflows while observing sessions, goals, schedules, and fleet health.
- Explore property graphs, RDF, schemas, objects, tables, documents, code, and memories through Atlas and Epistemic Graph.
- Discover MCP Apps and connector capabilities without exposing service credentials to the browser.
- Apply one role-aware navigation and server authorization model across the complete workspace.
- Run as the Graph OS-hosted browser co-service or as an independently deployed ASGI application.

## Documentation

Start with the [GraphOS documentation](https://knuckles-team.github.io/graph-os-webui/),
then use the shared platform map to move between components:

| Component | Role | Documentation |
|---|---|---|
| GraphOS | Browser operator workspace and Atlas knowledge views | [Docs](https://knuckles-team.github.io/graph-os-webui/) |
| Agent Terminal UI | Terminal and headless client; REST operations are available, with no ACP conversational path | [Docs](https://knuckles-team.github.io/agent-terminal-ui/) |
| Geniusbot | Desktop cockpit for chat, graph, fleet, health, and operator workflows | [Docs](https://knuckles-team.github.io/geniusbot/) |
| Graph OS messaging | Hosts chat and voice entrypoints; Agent Utilities supplies adapter and routing behavior | [Docs](https://knuckles-team.github.io/graph-os/) |
| Graph OS | Public MCP, REST, A2A, identity, policy, and runtime composition | [Docs](https://knuckles-team.github.io/graph-os/) |
| Agent Utilities | Agent decisions, workflows, evaluation, and skills | [Docs](https://knuckles-team.github.io/agent-utilities/) |
| Epistemic Graph | Durable multimodal data, reasoning, provenance, and transactions | [Docs](https://knuckles-team.github.io/epistemic-graph/) |
| Agent Connector SDK | Typed source adapters, connector serving, and write-back contracts | [Docs](https://knuckles-team.github.io/agent-connector-sdk/) |

## Architecture

![Runtime architecture: people use GraphOS, Agent Terminal UI, Geniusbot, and Graph OS-hosted messaging; MCP, REST, and A2A clients enter through Graph OS; source systems flow through Agent Connector SDK into Epistemic Graph.](docs/assets/runtime-architecture.svg)

People also enter through Agent Terminal UI and Geniusbot or Graph OS-hosted
messaging; Agent Terminal UI exposes REST operations, with no ACP conversational
path. External applications connect over MCP, REST, or A2A. The browser talks
only to its same-origin FastAPI host. Graph OS injects gateway routes and
verified request context, then delegates agent behavior to Agent Utilities and
durable knowledge to Epistemic Graph. Source systems connect through Agent
Connector SDK directly to Epistemic Graph. GraphOS renders typed results
and local presentation state while each service retains its own authority.

See the [architecture guide](https://knuckles-team.github.io/graph-os-webui/architecture/)
for the request flow and trust boundaries.

## Quick start

Generate a local profile and launch Graph OS with GraphOS enabled:

```bash
uvx --from "graph-os[webui]" setup-config generate --profile tiny
export ENABLE_WEB_UI=true
uvx --from "graph-os[webui]" graph-os --transport streamable-http --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8080>. Graph OS serves MCP on port `8000` and the Agent
Web UI co-service on port `8080`. The [start guide](https://knuckles-team.github.io/graph-os-webui/start/)
covers local source development and deployment profiles.

## Contributing

Issues and pull requests are welcome. Read [AGENTS.md](AGENTS.md), keep browser
and server authority boundaries intact, and run the repository validation suite
before opening a pull request.

## License

GraphOS is available under the [MIT License](LICENSE).
