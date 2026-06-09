# Agent WebUI

Agent WebUI is a React and FastAPI web interface for Pydantic AI agents built on
Agent Utilities. It provides a cinematic chat experience for complex agentic
workflows, visualizing background reasoning, rendering tool invocations, and
presenting a real-time sideband view of parallel multi-agent graph execution.

This documentation is the reference companion to the application. It describes how the
interface is composed, how it consumes streaming agent events, and how it integrates
with the wider agent platform.

## Where to start

- **[Architecture](architecture.md)** — The centralized epistemic gateway topology,
  protocol flow, component map, and backend structure.
- **[Agents & Events](agents.md)** — The graph-activity event types emitted by the
  orchestrator, specialist discovery, and telemetry.
- **[Features](features.md)** — The API endpoints, frontend environment variables, and
  the most recent architecture changes.
- **[Ecosystem Integration](ecosystem.md)** — The Unified Agent Homelab model, layout
  taxonomy, and the REST interfaces that expose installed agent packages and MCP
  servers.
- **[Concept Registry](concepts.md)** — The stable concept identifiers that trace the
  project's core ideas across documentation and source.

## Source and packaging

Agent WebUI is developed in the [agent-webui repository](https://github.com/Knuckles-Team/agent-webui)
and distributed on [PyPI](https://pypi.org/project/agent-webui/). For build, lint, and
test commands, see the repository `README.md` and `AGENTS.md`.
