# Deployment and operations

Agent WebUI ships as a Python wheel and a container image. In a complete Graph OS
deployment it runs as the browser-facing presentation service and composes the
canonical gateway routes supplied by Graph OS and Agent Utilities.

## Security boundary

The standalone server listens on loopback by default. A non-loopback listener fails
closed unless all of the following are configured:

- a JWKS URI, issuer, and audience for JWT verification;
- an explicit `ALLOWED_HOSTS` allowlist;
- exact browser origins where cross-origin access is required; and
- an authentication-aware same-origin proxy for browser API and WebSocket requests.

The browser does not retain a Graph OS service bearer. Server-side adapters mint
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

## Build and deploy

Use the repository-owned deployment script for local releases:

```bash
docker/deploy.sh
```

It selects an available Docker or BuildKit backend, builds and verifies the image,
pushes it by immutable digest, deploys that digest, waits for availability,
rebuilds the live-mounted frontend bundle, and verifies the running pod serves
the new assets. It prints the current rollback digest before changing the
deployment and prints the exact rollback command when it finishes.

Two non-deploying modes are available:

```bash
docker/deploy.sh --build-only   # build and verify locally
docker/deploy.sh --skip-deploy  # build, verify, and push without changing Kubernetes
```

The lower-level `docker/build_and_push.sh` script is the build half used by
`docker/deploy.sh`. It supports `--backend docker` and `--backend buildkit` when
backend autodetection is not appropriate.

Do not replace these scripts with a hand-written image build or deployment sequence.
The contract covers two independent artifacts:

1. the digest-pinned backend image; and
2. the frontend `dist/` directory that may be shadowed by a live source mount.

A rollout restart does not change a digest-pinned image, and an image update
alone does not refresh a shadowed frontend bundle. The deployment script
updates and verifies both.

## Concurrent operators

Only one Agent WebUI Kubernetes Deployment is active for a given environment. When
another operator is deploying, build and push without changing the cluster:

```bash
docker/deploy.sh --skip-deploy
```

Coordinate which digest should become active, then run the normal deployment command
after the existing operation completes. Never race two `kubectl set image` operations.

## GitHub release pipeline

`.github/workflows/release.yml` is the release authority. It publishes the
Python package first and builds the container from the same commit only after
that publication succeeds. The container job verifies that the required
epistemic-graph release is resolvable before building.

`.github/workflows/advisory.yml` owns documentation publication. Documentation
failures remain visible without publishing a package or image from an
unverified release job.

## Kubernetes contract

The deployment manifest describes the workload shape, configuration, mounts, probes,
and readiness policy. Its `image` value is a recorded deployment point, not a mutable
release channel. Promote a newly verified image by its digest through `docker/deploy.sh`.

After deployment, confirm:

- the pod's `imageID` matches the promoted digest;
- liveness and readiness probes pass;
- the WebUI security doctor reports `ok`;
- the served frontend bundle matches the release commit; and
- authenticated Graph OS and MCP delegation paths return governed responses.

## Rollback

Use the digest and rollback command printed by `docker/deploy.sh`. A rollback
must restore the backend image and the compatible frontend bundle together,
then repeat the health, security, and asset checks above.
