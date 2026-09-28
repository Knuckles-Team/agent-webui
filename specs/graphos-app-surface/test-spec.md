# GraphOS shell and app verification

| Case | Level/fixture | Pass |
|---|---|---|
| Product identity | Asset-generator check, metadata/route snapshots | All exposed names and generated hashes match |
| Package/consumer | Wheel, import and Graph OS consumer fixture | Canonical package imports; release assets included; no old runtime alias |
| Native app | Markets fixture + route/client/WebMCP/renderer tests | Single AppSurface registers all declared pieces |
| Contributed app | Valid descriptor and malformed/unauthorized descriptors | Valid app appears per capability; invalid entries fail closed without code loading |
| Old state and grants | Browser profile with prior consent/tool IDs | Re-consent required; old grant cannot invoke new tool |
| Direct denied URL | Two-principal browser fixture | No privileged component data or tool registration exposed |
| Mobile/desktop accessibility | Playwright keyboard/touch and reduced-motion fixture | Focus, nav labels, hit targets, contrast and error states pass |
| Public site | `mkdocs build --strict` and Pages artifact inspection | Links/assets resolve under published base path |

Run `pnpm run typecheck`, `pnpm run test`, `pnpm run test:e2e`, `pnpm run build`, `uv run --all-extras pytest agent/agent_webui/__tests__`, and `pre-commit run --config .config/pre-commit.yaml --all-files`. Hosted CI provisions browser and API fixtures; no live deployment is required to accept an external PR. CCCC staged threshold is no new function above cyclomatic 10/cognitive 15 and no regression. Run configured jscpd and Dupehound if installed; do not claim an unconfigured threshold passed. KISS rejects duplicate route/app/renderer registries. Record package, Pages and browser artifact digests with exact commit in `tasks.md`.
