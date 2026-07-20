# KG Extraction view (AU-ECO.connector.git-task-resolver)

`ExtractionView` (`src/components/views/ExtractionView.tsx`, route `/extraction`,
sidebar **KG Extraction**) turns a document or URL into an interactive knowledge
graph, live.

## What it does

- **Ingest** — paste text or enter a URL; set rounds and toggle semantic dedup.
- **Stream** — submits to the gateway, then opens an `EventSource` on
  `/api/enhanced/extract/stream/{job_id}` and renders each `(subject)
  -[predicate]-> (object)` fact onto a **Sigma.js + ForceAtlas2** force graph as
  it arrives. Node keys are NFKC-normalized so surface-form variants merge.
- **Inspect** — hover an edge for its fact card: title, triple, description,
  confidence %, tags, verbatim evidence span, source file, and a duplicate badge.
- **Job queue** — a panel polls `/api/enhanced/extract/jobs` and shows the
  GPU-slot queue (queued/running/paused/held) with pause/resume.
- **Longest chain** — toggle to highlight the longest directed fact chain.
- **Export** — download the job's facts as JSONL.

## Backend contract

All data flows over the shared `/api/enhanced/extract/*` gateway surface (submit,
stream, jobs, status, jsonl, pause, resume). The API wrappers live in
`src/lib/api.ts` (`submitExtraction`, `extractionStreamUrl`, `listExtractionJobs`,
…). The full subsystem is documented in agent-utilities
`docs/architecture/document_fact_extraction.md` (KG-2.64 extractor, KG-2.65
GPU-slot scheduler, KG-2.66 readability reader).
