# Design-system verification

| Test | Fixture | Pass |
|---|---|---|
| Token contrast | Light/dark token table | Text and controls meet WCAG 2.2 AA contrast where applicable |
| Keyboard and focus | Chat, Atlas filter/query/result, operational form | Full task completion, visible focus, correct dialog focus restore |
| Accessible names | Repeated Atlas clauses and error forms | Unique names, associated errors, sensible announcements |
| Responsive | 320/375/768/1440px screenshots | No overflow or unreachable primary action |
| Motion and touch | Reduced-motion and touch profile | Equivalent action/feedback without gesture or animation |
| States | Loading/empty/stale/denied/error/success fixtures | Text distinctions, no color-only meaning |
| Reuse/privacy | Source/asset/dependency audit | No duplicate primitive, real-user data or telemetry request |
| Skill distillation | Compare each adopted rule with existing public skill and component ownership | Distinct rule has license record, owner, example and failing/passing UI check; duplicate names and copied text rejected |
| Strict style policy | Built bundle served by `SecurityHeadersMiddleware` in headless Chromium | No `securitypolicyviolation` event for `style-src-elem` or `font-src`; each document nonce differs (WEBUI-DESIGN-R008, WEBUI-DESIGN-R009) |
| Offline review | Disable network except local test host and run synthetic journeys | Review and accessibility checks complete without remote critique or telemetry request |

Run `pnpm run typecheck`, `pnpm run test`, `pnpm run test:e2e`, `pnpm run build`, and `pre-commit run --config .config/pre-commit.yaml --all-files` on the exact commit. E2E provisions local fixtures and browser; no live hosted environment is required for a PR. CCCC's configured staged rule rejects new functions above cyclomatic 10/cognitive 15 and regressions. Use configured jscpd and Dupehound if available; missing configuration is a gap. KISS requires adapting existing components and tokens before adding a primitive. Record automated accessibility findings plus manual keyboard/screen-reader notes and screenshot artifact digests in `tasks.md`.

## Responsive workspace acceptance matrix

The following are planned tests, not existing receipts. Test every registered static destination and representative authorized/denied dynamic leaves, including nested leaves deeper than three levels. Generate action cases from the shared census rather than hand-picking top-level pages.

| Requirement | Required proof |
|---|---|
| WEBUI-DESIGN-R002.1 | Token/layout snapshots and task-completion review at the declared viewport matrix. |
| WEBUI-DESIGN-R004.1 | All-route/action coverage at 320 CSS px, narrow/tall, low-height landscape, 4:3,16:9,32:9 and generated intermediate dimensions; no unsupported/mobile-only omission. |
| WEBUI-DESIGN-R004.2 | Resize during form editing, stream updates and graph navigation. Test keyboard-open and 200-percent zoom states without lost state or unreachable controls. |
| WEBUI-DESIGN-R005.1 | Keyboard/screen-reader/touch and reduced-motion journeys through deepest fixtures, interrupted transition and focus restoration tests. |
| WEBUI-DESIGN-R010 | Reproducible load/interaction traces, memory/idle checks and budget assertions plus reduced-motion tests on the exact release candidate. |

Run each relevant journey with loading, empty, stale, denied, unavailable, validation error, success and in-flight cancellation fixtures. Use synthetic tenant data. No auth tokens, private reasoning, real account data or secrets may appear in screenshots, tool results or logs. Existing source and security gates remain mandatory.
