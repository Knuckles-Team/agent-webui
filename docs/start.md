# Start Arbora

Arbora is served as an Arbora co-service. This is the shortest path to a
browser surface with the correct routing and authority boundaries.

## Requirements

- Python 3.12 through 3.14
- A local or deployed epistemic-graph endpoint accepted by the generated
  Arbora profile
- A supported model provider configured for conversations and agent runs

## Install and run

```bash
uvx --from "arbora[webui]" setup-config generate --profile tiny
export ENABLE_WEB_UI=true
uvx --from "arbora[webui]" arbora --transport streamable-http --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8080>. The MCP transport listens on port `8000`; the
WebUI co-service uses port `8080`. Set `ARBORA_WEBUI_PORT` when that port is
already in use.

The successful first screen shows the Arbora navigation and dashboard.
Atlas at `/explore` presents the graph, object, schema, data, document, and
memory entry points exposed by the connected runtime.

!!! note "Local identity posture"

    A loopback-only local profile can run without SSO. Network exposure is a
    different security posture: configure the documented identity, host,
    origin, and TLS controls before binding publicly.

## Work on the interface from source

Use the packaged Arbora process for the backend, then run Vite for frontend
changes:

```bash
git clone https://github.com/Knuckles-Team/overstory.git
cd overstory
pnpm install --frozen-lockfile
BACKEND_PORT=8080 pnpm run dev
```

Vite serves the development frontend at <http://127.0.0.1:9000> and proxies
API, ACP, and browser-control traffic to the Arbora-hosted WebUI co-service.

## Check the build

```bash
pnpm run typecheck
pnpm run test
pnpm run build
```

Continue with [architecture](architecture.md) for the request path or
[deployment and operations](deployment.md) for production controls.

## Workspace entry and existing links

After sign-in, `/` opens Work for user-or-higher roles and Operate for readers.
The previous system overview remains available at `/overview`. Administrator
links to `/prompts` open the shared prompt-authoring lens in Work. These entry
changes preserve query and fragment context. They replace the current history
entry, so Back does not stop on an intermediate redirect. Invalid or conflicting
Work selections show an error rather than silently changing the selection.

Other existing destinations remain available while their capabilities migrate.
Prompt edits survive switching Work lenses; changing the admitted identity
retires those drafts. Leaving Work for an unmigrated destination still leaves
that workspace, so save wanted changes before doing so.
