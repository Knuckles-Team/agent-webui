---
name: kg-webui-extraction
description: >-
  The agent-webui document / entity extraction surface — submit text or a URL for
  GPU-slot fact extraction, watch jobs stream facts live, pause/resume, and export
  results. Use when you want to extract entities/facts from a document in the UI,
  monitor an extraction job, or download extracted facts as JSONL.
license: MIT
tags: [graph-os, webui, extraction, facts, documents, entities]
tier: surface
metadata:
  author: Genius
  version: '0.1.0'
---

# kg-webui-extraction (surface)

Documents the document→knowledge-graph fact-extraction UI (ECO-4.43;
KG-2.64/2.65/2.66): submit a document, watch a GPU-slot job emit facts round by
round over SSE, pause/resume it, and export the deduplicated facts.

## UI route (agent-webui/src/App.tsx)
- `/extraction` — `ExtractionView` (submit form, live job list, streaming fact
  log, JSONL download).

## Backing endpoints (from src/lib/api.ts, under /api/enhanced/extract/)
- `POST /submit {text|url, rounds?, dedup?, dedup_field?, dedup_threshold?}` —
  enqueue a job (`submitExtraction`), returns `{status, job_id}`.
- `GET /jobs` — job rows (`listExtractionJobs`), each an `ExtractionJob`
  (`state`, `total_facts`, `unique_facts`, `duplicate_facts`, `preempted`…).
- `GET /status/{job_id}` — single job status (`getExtractionStatus`).
- `POST /pause/{job_id}` / `POST /resume/{job_id}` (`pauseExtraction` /
  `resumeExtraction`).
- `GET /stream/{job_id}` — SSE of `round_start|fact|…|job_done`
  (`extractionStreamUrl`, consumed via EventSource).
- `GET /jsonl/{job_id}` — download facts as JSONL (`extractionJsonlUrl`).

## How an agent drives it
Navigate to `/extraction`, or call directly: `POST /api/enhanced/extract/submit`
with text or a URL, poll `GET /api/enhanced/extract/status/{job_id}` (or attach
an EventSource to `/stream/{job_id}`), and pull results from `/jsonl/{job_id}`.
For headless document ingestion prefer the `kg-ingest` verb skill
(`document_process` / `source_sync`); use this surface for interactive,
observable extraction runs.
