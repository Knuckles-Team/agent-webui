# Status

Arbora is the browser workspace composed and hosted by Arbora. The
published package also exposes the same FastAPI application for standalone ASGI
deployment.

## Current surfaces

| Surface | Current contract |
|---|---|
| Browser workspace | Conversations, approvals, workflows, fleet activity, and Atlas knowledge views share one role-aware application shell. |
| Arbora composition | Arbora starts Arbora as a supervised co-service and injects governed application routes. |
| Standalone host | The standalone FastAPI application serves Web UI-owned routes without claiming Arbora-owned gateway authority. |
| Knowledge views | Atlas renders typed graph, RDF, schema, object, table, document, code, and memory results from the owning services. |
| Security boundary | The browser keeps privileged service credentials server-side; the host remains authoritative for identity and permissions. |

## Release evidence

- [PyPI package](https://pypi.org/project/agent-webui/)
- [Release workflow](https://github.com/Knuckles-Team/agent-webui/actions/workflows/release.yml)
- [Documentation workflow](https://github.com/Knuckles-Team/agent-webui/actions/workflows/pages.yml)
- [GitHub releases](https://github.com/Knuckles-Team/agent-webui/releases)

Use the workflow records for commit-specific build results and the
[architecture guide](architecture.md) for current ownership and request paths.
