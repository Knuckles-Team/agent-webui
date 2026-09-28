# Decision evidence verification

| Scenario | Level and fixture | Expected result |
|---|---|---|
| DEC-01 selected and excluded options | Contract + rendered route; two-option synthetic certificate | Exact identifiers, derivations and constraints remain navigable; no invented premise |
| DEC-02 why-not | FastAPI/Graph OS adapter fixture for success, timeout, denial | Original decision unchanged; bounded request and distinct diagnostic |
| DEC-03 evaluated cohort | Rendered route with independently labeled receipt | Coverage/risk labels include cohort, count, version, window and receipt |
| DEC-04 missing/synthetic/underpowered | Three negative fixtures | No numeric bound or deployable badge |
| DEC-05 tenant switch/race | Browser test with delayed first response and second identity | Old content never flashes or persists; denied body not leaked |
| DEC-06 interaction | Playwright keyboard and axe-style accessibility audit | Focus order, labels, table headers, contrast and text alternatives pass |

Run `pnpm run typecheck`, `pnpm run test`, `pnpm run test:e2e`, `pnpm run build`, and `uv run --all-extras pytest agent/agent_webui/__tests__`. The E2E job starts its own browser, host, Graph OS fixture and test identity; an unavailable external deployment is not a pass and is not a commit-blocking local prerequisite. Run `pre-commit run --config .config/pre-commit.yaml --all-files` and hosted CI on the exact commit. The configured CCCC staged rule allows no new function above cyclomatic 10/cognitive 15 and no regression. Apply configured jscpd and Dupehound scanners when present; if not configured in this checkout, record a quality-gap issue rather than inventing thresholds. KISS: reuse route, auth and renderer seams; reject duplicate decision calculations. Store commit, CI URL, browser fixture/version and outcomes in `tasks.md`.
