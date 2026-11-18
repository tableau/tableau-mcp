---
sidebar_position: 9
---

# Run Flow Task

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

  Runs an **existing scheduled flow run task** now ("Run Now" on a schedule), by task id. The task runs with the output steps and parameters it was configured with; a suspended task is resumed. This ENQUEUES the run and returns immediately with an async job — the run is NOT finished when this tool returns.

  Choose this tool over `run-flow` when the user wants to trigger a flow's **existing schedule/task** right now (you have a *task id* from `list-flow-tasks`), rather than an ad-hoc run with caller-chosen output steps (`run-flow`, which takes a *flow id*).

  **This tool changes server state** (it runs the flow, consuming Prep Conductor capacity and overwriting outputs). Only call it when the user asks to run the task.

  **Two-phase confirmation:**
  1. **Preview** (`confirm` omitted or false): describes the task run without enqueuing it and returns a single-use confirmation token.
  2. **Run** (`confirm: true`): requires the token from the matching preview before enqueuing the task.

  **Parameters:**
  - `taskId` (required) – The flow run task id from `list-flow-tasks` (the task `id`, i.e. the flowRun id).
  - `confirm` (optional) – Set `true` only after the user approves the preview.
  - `confirmationToken` (optional) – The single-use token returned by the matching preview. Required when `confirm` is true.

  **Response:** Preview returns instructions and a confirmation token. A confirmed call returns `{ job, mcp: { runStatus } }` — `job.id` (background job id) and `job.runFlowJobType.flowRunId`. Asynchronous: report it as *started*, then poll `list-flow-runs` / `get-flow` for the outcome.

  **Requirements & limits:**
  - Requires **Data Management with Tableau Prep Conductor**; the site's **Run Now** setting must be enabled.
  - **Caller-role:** non-administrators can only run flow run tasks they own.
  - Not idempotent. If a run for the task is already queued/in progress the request may be rejected.
  - **Bounded-context note:** when this MCP server is restricted to specific projects/tags, this tool cannot verify that a task's flow is in the allowed set (a task carries no project/tag and is addressed only by task id), so it refuses. Use `run-flow` (by flow id) in that configuration.
  - Requires Tableau REST API access scopes `tableau:flow_tasks:run` and `tableau:mcp_site_settings:read`.

## APIs called

Talks to Tableau Cloud or Tableau Server.

- 
  Runs an **existing scheduled flow run task** now ("Run Now" on a schedule), by task id.

## Required arguments

### `taskId`

The taskId argument.

## Optional arguments

### `confirm`

The confirm argument.

### `confirmationToken`

The confirmationToken argument.

{/* tool-details */}
## Two-phase confirmation

1. **Preview** (default, with `confirm` omitted or `false`): describes the task run without
   enqueuing it and returns a single-use `confirmationToken`.
2. **Run** (`confirm: true`): requires the token from a matching preview. Present the proposed run to
   the user and get explicit approval before making the confirmed call.

## Requirements

- Requires **Data Management with Tableau Prep Conductor**; the site's **Run Now** setting must be enabled.
- **Caller-role:** non-administrators can only run flow run tasks they own.

## Bounded context (fail-closed)

A flow run task carries no project or tag and is addressed only by task id, so when the server is
restricted to an `INCLUDE_PROJECT_IDS` / `INCLUDE_TAGS` bounded context this tool **cannot** verify the
task's flow is in the allowed set and **refuses** (mirroring [List Flow Tasks](./list-flow-tasks.md)).
Use [Run Flow](./run-flow.md) by flow id in that configuration.

## Response

An object `{ job, mcp: { runStatus } }` — `job.id` (background job id) and
`job.runFlowJobType.flowRunId`. Asynchronous: report it as _started_, then poll
[List Flow Runs](./list-flow-runs.md) / [Get Flow](./get-flow.md) for the outcome.
{/* /tool-details */}
