# Operate qualification source backup

These scripts preserve the installed synthetic journeys behind PRs 140, 152 and 158.
They are manual qualification fixtures, not production services or automatic CI tests.
Backup edits cover portable paths, formatting, type annotations, explicit temporary storage and fixture lifecycle recording.
No stored keys, bearers, reports, screenshots or upstream source copies are included.

Use an isolated environment with the candidate WebUI installed and its production assets built.
The original qualification used Arbora 0.1.7, Agent Utilities 3.1.0, SDK 0.2.2 and epistemic-graph 2.27.5.
Install the repository frontend dependencies and Playwright browser before invoking a browser script.
Run each server and browser pair separately from the repository root:

```sh
export OPERATE_QUALIFICATION_DIR="$(mktemp -d)"
python e2e/fixtures/operate-qualification/migration_served.py
node e2e/fixtures/operate-qualification/migration_browser.cjs
```

The servers bind loopback ports 18765, 18766 and 18767 for catalog, readiness and migration respectively.
They generate temporary signing keys and synthetic bearer files inside the required private `OPERATE_QUALIFICATION_DIR` directory.
The browser scripts use that same directory for marker files, reports and screenshots.
Stop the fixture server and remove its temporary bearer after each run.
Do not run these fixtures inside an existing production process.

The catalog pair preserves registration, definition, filtering and refusal journeys from PR 140.
The readiness pair preserves PR 152 behavior, including its historical generic denial message.
The migration pair preserves PR 158 alias, history, focus, catalog and readiness journeys.
Historical browser assertions are not claims that earlier candidates still match current UI text.

Browser identity, catalog authority, engine probes, fleet context, policy and audit storage are synthetic.
Catalog and readiness requests cross the installed routes and real bearer verification.
The fleet helper registers only discovery reads; effects refuse execution.
Installed host admission refused its discovery POSTs with HTTP 403 for the synthetic reader.
No additional grants were added to overcome that refusal.
These fixtures do not qualify provider connectivity, durable audit or production authentication.
Backup publication does not expand requirement acceptance or claim a new end-to-end run.
