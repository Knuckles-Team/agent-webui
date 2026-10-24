# Deployment and operations

Agent Web UI ships only as a Python package on PyPI (wheel and sdist). Arbora
installs it through its `webui` extra and serves it in-process on port 8080,
next to MCP and REST. It is the browser-facing presentation service and composes
the canonical gateway routes provided by Arbora and Agent Utilities.

## Security boundary

The standalone server listens on loopback by default. A non-loopback listener fails
closed unless all of the following are configured:

- a JWKS URI, issuer, and audience for JWT verification;
- an explicit `ALLOWED_HOSTS` allowlist;
- exact browser origins where cross-origin access is required; and
- an authentication-aware same-origin proxy for browser API and WebSocket requests.

The browser does not retain an Arbora service bearer. Server-side adapters mint
the request-scoped graph identity and perform privileged MCP operations through
audited, host-injected delegation ports.

Before exposing a listener, inspect the effective contract:

```bash
python -m agent_webui.server --security-doctor --host 0.0.0.0
```

The CLI disables Uvicorn access logging because raw query strings can contain searches,
graph symbols, and other sensitive values. An embedding ASGI server must set
`AGENT_WEBUI_ACCESS_LOG_POLICY=disabled` or provide a redacting logger and
attest with `AGENT_WEBUI_ACCESS_LOG_POLICY=redacted`.

Content Security Policy defaults to self-hosted content with frames denied.
Additional script, style, image, font, connection, media, worker, and frame
sources must be exact origins in the corresponding
`AGENT_WEBUI_CSP_*_SOURCES` variables. Wildcards, credentials, paths, and
directive injection are rejected. Custom HTML rendering also requires
`AGENT_WEBUI_CSP_CUSTOM_RENDERING=1`.

## Install and serve

There is no container image. Install Arbora with the `webui` extra and enable
the co-service:

```bash
uvx --from "arbora[webui]" arbora --transport streamable-http --host 127.0.0.1 --port 8000
```

Upgrade by moving Arbora's pinned `agent-webui` release; roll back by pinning
the previous release. After either, run the security doctor and confirm the
served frontend bundle matches the release.

## GitHub release pipeline

`.github/workflows/ci.yml` runs the pull request and main checks and never
publishes. `.github/workflows/release.yml` is the release authority and runs
only on a `v*` tag or a manual dispatch. It publishes the wheel and sdist to
PyPI and creates the GitHub release; PyPI is the only release output.

`.github/workflows/pages.yml` owns documentation publication.

After an upgrade, confirm:

- liveness and readiness probes pass;
- the WebUI security doctor reports `ok`;
- the served frontend bundle matches the release; and
- authenticated Arbora and MCP delegation paths return governed responses.
