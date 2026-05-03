# Code Enhancement: agent-webui

> Automated code enhancement review for agent-webui. Covers 17 analysis domains.

## User Stories

- As a **developer**, I want to **address Dependency Audit findings (grade: C, score: 70)**, so that **improve project dependency audit from C to at least B (80+)**.
- As a **developer**, I want to **address Security Analysis findings (grade: F, score: 50)**, so that **improve project security analysis from F to at least B (80+)**.
- As a **developer**, I want to **address Test Coverage findings (grade: F, score: 55)**, so that **improve project test coverage from F to at least B (80+)**.
- As a **developer**, I want to **address Concept Traceability findings (grade: F, score: 41)**, so that **improve project concept traceability from F to at least B (80+)**.
- As a **developer**, I want to **address Test Execution findings (grade: F, score: 20)**, so that **improve project test execution from F to at least B (80+)**.
- As a **developer**, I want to **address Version Sync Analysis findings (grade: D, score: 60)**, so that **improve project version sync analysis from D to at least B (80+)**.
- As a **developer**, I want to **address Environment Variables findings (grade: D, score: 62)**, so that **improve project environment variables from D to at least B (80+)**.

## Functional Requirements

- **FR-001**: MAJOR update: starlette 0.50.0 (installed) -> 1.0.0
- **FR-002**: Minor update: sse-starlette 3.0.3 (installed) -> 3.4.1
- **FR-003**: Minor update: uvicorn 0.38.0 (installed) -> 0.46.0
- **FR-004**: Minor update: pydantic-ai 1.83.0 (installed) -> 1.88.0
- **FR-005**: Minor update: opentelemetry-instrumentation-starlette 0.60b1 (installed) -> 0.62b1
- **FR-006**: Minor update: opentelemetry-instrumentation-fastapi 0.60b1 (installed) -> 0.62b1
- **FR-007**: Minor update: opentelemetry-instrumentation-asgi 0.60b1 (installed) -> 0.62b1
- **FR-008**: Monolithic: api_extensions.py (1670L) — Low cohesion: 69 distinct concepts in one file; 68 public functions — consider grouping into modules
- **FR-009**: 4 MEDIUM severity vulnerabilities found
- **FR-010**: Low test-to-source ratio: 0.02
- **FR-011**: Test suite lacks intent diversity (only one type)
- **FR-012**: 21 potential doc-test drift items
- **FR-013**: README missing: References /docs directory material
- **FR-014**: SRP: 4 modules exceed 500 lines (god modules)
- **FR-015**: SRP: 2 classes have >15 methods
- **FR-016**: Low dependency injection ratio: 0%
- **FR-017**: Low traceability ratio: 0% concepts fully traced
- **FR-018**: 6 orphaned concepts (only in one source)
- **FR-019**: 2 test functions missing concept markers
- **FR-020**: 72 significant functions (>10 lines) missing concept markers in docstrings
- **FR-021**: Total lint findings: 2 (high/error: 0, medium/warning: 2, low: 0)
- **FR-022**: 2 hook(s) may be outdated: ruff-pre-commit, uv-pre-commit
- **FR-023**: 1 test execution error(s)
- **FR-024**: 1 directories with >20 files: src/components/ui
- **FR-025**: Found 2 file(s) with version '0.2.0' that are NOT tracked in .bumpversion.cfg:
- **FR-026**:   - .specify/reports/results.json
- **FR-027**:   - .specify/reports/code_enhancement_report.md
- **FR-028**: Version drift: pyproject.toml=0.2.0 vs CHANGELOG.md=1.1.0
- **FR-029**: No changelog entries within the last 30 days
- **FR-030**: 1 tests have no assertions
- **FR-031**: Only 4% of env vars documented in README.md
- **FR-032**: Undocumented env vars: AGENT_NAME, AGENT_WORKSPACE, ANTHROPIC_API_KEY, BASE_URL, DATABASE_PATH, GOOGLE_API_KEY, GRAPH_BACKEND, GRAPH_DB_PATH, GROQ_API_KEY, LANGFUSE_HOST
- **FR-033**: 4 Python env vars not in .env.example: GRAPH_BACKEND, GRAPH_DB_PATH, OLLAMA_BASE_URL, OLLAMA_HOST

## Success Criteria

- Overall GPA: 2.35 → 3.0
- Domains at B or above: 10 → 17
- Actionable findings: 33 → 0
