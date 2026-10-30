# Overstory Python host

The packaged FastAPI boundary and built React assets for
[Overstory](../README.md).

## Overview

This package creates the browser-facing ASGI application. It owns WebUI routes,
session behavior, security middleware, and static application serving. Arbora
injects the platform gateway and checked runtime context through the public
`ApplicationComposer` seam.

## Key Capabilities

- Serve the compiled React single-page application.
- Stream agent conversations through AG-UI and ACP.
- Enforce host, origin, identity, role, request-size, and content-security boundaries.
- Accept Arbora gateway, MCP delegation, browser-control, voice, and contact ports.
- Expose health and security-doctor checks for deployment automation.

## Documentation

Use the [published documentation](https://knuckles-team.github.io/overstory/)
for setup, architecture, feature reference, and operations. The
[ecosystem map](https://knuckles-team.github.io/overstory/ecosystem/) explains
the boundary between this host and Arbora.

## Architecture

`create_agent_web_app()` builds the WebUI-owned routes first, invokes the
host-supplied `ApplicationComposer`, mounts the SPA last, and wraps the complete
application in the security and observability middleware stack. The standalone
entry point intentionally omits Arbora-owned routes.

## Quick Start

Run the complete Arbora-hosted composition from the repository root:

```bash
uvx --from "arbora[webui]" setup-config generate --profile tiny
export ENABLE_WEB_UI=true
uvx --from "arbora[webui]" arbora --transport streamable-http --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8080>.

## Contributing

Keep browser-specific transport and security behavior here, and keep platform
routing, fleet supervision, and runtime policy in Arbora. Follow the root
[contribution guidance](../AGENTS.md).

## License

Overstory is available under the [MIT License](../LICENSE).
