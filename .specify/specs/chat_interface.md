# Chat Interface Specification

## Overview
The chat interface is the primary interaction point for the agent-webui. it handles message streaming, tool execution visualization, graph activity timelines, and human-in-the-loop approvals.

## User Stories
- **As a User**, I want to see real-time streaming of agent responses so that I can follow its reasoning.
- **As a User**, I want a clear visualization of tool calls and graph routing so that I understand the agent's actions.
- **As a User**, I want to approve sensitive tool calls (like bash commands) so that I maintain control over my system.

## Functional Requirements
- **FR-001 (Streaming)**: MUST support SSE-based streaming via AG-UI and ACP protocols.
- **FR-002 (Graph Activity)**: MUST render the `GraphActivity` timeline showing specialist routing, parallel execution, and expert reasoning.
- **FR-003 (Tool UI)**: MUST render tool calls with appropriate UI parts (e.g., code snippets, image previews, elicitations).
- **FR-004 (Approvals)**: MUST intercept security-sensitive tool calls and display an `ApprovalCard`.

## Success Criteria
- **Latency**: UI interaction remains responsive during high-volume streaming.
- **Reliability**: Conversation state is persisted correctly across sessions.
- **Clarity**: All agent status events (routing, planning, executing) are visually represented.

## Data Model (Draft)
- `ChatMessage` (Entity)
- `ToolCall` (Entity)
- `GraphEvent` (Entity)
