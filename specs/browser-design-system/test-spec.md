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
| Offline review | Run synthetic journeys with local networking only | Accessibility review completes without remote critique or telemetry |

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

## Workspace density regression

`e2e/workspace-density.spec.ts` drives the rendered Explore route with synthetic
identity and unavailable-service fixtures. It checks a retained unsent query,
keyboard disclosure focus, no pane overflow, one/two-column geometry, and the
100rem maximum surface width at 320×740, 740×320, 1024×768, 1440×900,
2560×720 and 587×913. A 480px container inside a 1440px viewport proves the
layout depends on available workspace width. Screenshots and geometry are test
attachments. This is density evidence, not all-route parity, real-service
acceptance, screen-reader certification or semantic-zoom acceptance.

Run with `corepack pnpm exec playwright test --config e2e/workspace-layout.config.ts
e2e/workspace-density.spec.ts`. Existing Work, Explore and Operate rendered unit
suites cover retained actions and service states. No extra spec child is created.

## Partial viewport continuity regression

Run `pnpm exec playwright test --config e2e/workspace-viewport.config.ts` for
the rendered Explore query journey. It edits a draft while a synthetic response is pending, then changes viewport dimensions. Keyboard actions inspect results and return to the retained editor. One case uses native Chromium viewport
resize; another simulates visual-viewport occlusion independently of layout
viewport size. Both use reduced motion. Neither establishes native soft-keyboard,
fold hardware, browser zoom or live-provider acceptance.

`WorkspaceViewport.test.tsx` covers retained selection/focus, pinch-zoom reflow
avoidance, fallback without VisualViewport, and listener cleanup. These tests
do not complete WEBUI-DESIGN-R004.2; its broader acceptance remains open.
