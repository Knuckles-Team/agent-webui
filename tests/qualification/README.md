# Installed authentication qualification

These opt-in tests qualify installed candidates with synthetic identities.
They do not qualify live providers or native EG login.
Normal pytest collection retains these test items and skips their execution unless
`WEBUI_INSTALLED_QUALIFICATION=1`, including when a PR selects only these files.
Optional installed-candidate imports happen only during execution.
A skip is not acceptance evidence. Ordinary runner regression tests exercise
isolation and failure propagation without claiming installed qualification.
An explicitly requested harness run fails when prerequisites are absent.

## Prerequisites

- Build WebUI with frozen dependencies and `pnpm run build`, then `uv build --wheel`.
- Install that exact wheel and a compatible Arbora wheel in an isolated Python environment.
- Install the test dependencies from this repository's `test` extra in that environment.
- Arbora must expose `identity_factory_kwargs`. WebUI must expose explicit `auth_mode`.
- Use published dependencies or record the exact candidate commits and wheel SHA-256 values.
- For browser checks, run repository bootstrap and `pnpm exec playwright install chromium`.
- Allow local loopback sockets. No live provider, credentials or production settings are required.

The tests assert installed imports and packaged assets. Editable package installs fail.
Record the versions and wheel hashes separately; a candidate version label is not release evidence.
The harness does not build, install, release or upgrade packages automatically.

## Run

From the repository root, replace the two example paths:

```sh
python tests/qualification/run_installed.py \
  --python /path/to/isolated-environment/bin/python \
  --output /tmp/webui-auth-evidence \
  --browser lifecycle
```

The harness copies Python fixtures to a temporary directory outside the checkout.
It runs the selected interpreter without a source overlay or inherited application configuration.
It starts a loopback issuer and WebUI process, then stops both after the browser run.
Logs, screenshots and the result receipt stay in the output directory, outside tracked source.
The runner reports protocol-test failures before starting browser checks.

Omit `--browser` for protocol and packaging checks only.
Use `--browser smoke` to record the signed-in menu and session response.
Use `--browser baseline` to record renewal refusal and whether the mounted user remains visible.
Baseline mode is diagnostic: it records behavior without requiring the historical defect.
Use separate output directories to preserve each run's evidence.

Lifecycle mode asserts successful renewal, offline retirement, reconnect, API refusal and delayed two-tab logout.
It requires the mounted identity repair and HTTP cookie/status repair in the installed candidate.
Older artifacts may fail these assertions; they must not silently skip them.
The other tab schedules a read within sixty seconds while authenticated.
Request deadlines and background browser throttling can extend the visible update time.

## Fixture authority and acceptance limits

All signing keys, client secrets, session keys and opaque test tokens are generated in memory.
No literal secret or private key is retained in source.
Do not commit logs that contain fixture failure details.
Discovery, authorization-code exchange, PKCE, RS256 verification, JWKS and refresh use real loopback HTTP.
The fixture uses an explicit synthetic identity and controlled clock offsets.
It does not implement a production provider or prove Keycloak/Okta interoperability.

No-auth and OIDC effect probes assert refusal before dispatch, not complete anonymous operation acceptance.
Native EG login is unavailable until Arbora supplies its production auth-route and admission owner.
These tests do not invent that owner or qualify streams, WebSockets, native effects or concurrent renewal safety.
Full `WEBUI-IDENTITY-R010` acceptance remains open.

## Retained source and redundancy

The former task-local sources map to maintained entrypoints as follows:

| Original source | Retained behavior |
|---|---|
| `candidate-installed-tests/test_composed_modes.py` | `test_composed_modes.py`: installed imports, assets, CSP nonce and effect refusal |
| `candidate-installed-tests/test_oidc_lifecycle.py` | `test_oidc_lifecycle.py` and `loopback_oidc.py`: signed protocol lifecycle and negative cases |
| `candidate-installed-tests/serve_browser_fixture.py` | `serve_browser.py`: loopback host, clock control and bounded cleanup |
| `rendered-browser-lifecycle.mjs` | `e2e/installed-auth.mjs`, lifecycle mode |
| `rendered-browser-baseline.mjs` | Same browser entrypoint, baseline mode |
| `rendered-browser-smoke.mjs` | Same browser entrypoint, smoke mode |
| `release-qualification/test_composed_modes.py` | The earlier probe is a subset of the retained composition test; no unique assertion is removed |
| `test_installed_canonical_required.py` | Arbora's existing `tests/webui_host/test_canonical_browser_composition.py`, `required` parameter case |

The last file was a copied canonical test with mode parameterization removed.
Arbora's maintained test retains its required-mode invocation and every transition assertion.
Run that test from the matching Arbora checkout for canonical EG adapter source evidence.
It uses synthetic owners; its auth-route fixture is not native login acceptance.
Do not copy that owner-specific test into WebUI as another implementation.

Those two superseded scripts are not byte-identical duplicates; their coverage is explicitly mapped above.
Byte-identical package/test copies used for previous outside-tree runs are not vendored here.
Installed package code comes from the selected wheels, and ordinary regression tests remain in their owning repositories.

For installed canonical checks, use Arbora commit `c02c0a4ba412a91c3d600d1144555fe816b3d0cf` and its matching test dependencies.
Copy only its tests outside both product checkouts. Run the selected installed interpreter without `PYTHONPATH`:

```sh
qualification_dir=$(mktemp -d)
cp -R /path/to/arbora/tests "$qualification_dir/tests"
(cd "$qualification_dir" && env -u PYTHONPATH \
  /path/to/isolated-environment/bin/python -m pytest -q \
  tests/webui_host/test_canonical_browser_composition.py -k required)
```

The retained required-mode selection covers 23 cases at that commit.
It preserves the older copied script's assertions without another test implementation.
Its synthetic auth routes still do not qualify native EG login.
