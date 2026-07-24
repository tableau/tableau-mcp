---
sidebar_position: 6
---

# Run Flow Task

Runs an **existing scheduled flow run task** now ("Run Now" on a schedule), by task id. The task runs
with the output steps and parameters it was configured with; a suspended task is resumed. This
enqueues the run and returns immediately with an async **job**.

Choose this tool over [Run Flow](run-flow.md) when the user wants to trigger a flow's _existing
schedule/task_ right now (you have a _task id_ from [List Flow Tasks](list-flow-tasks.md)) rather than
an ad-hoc run with caller-chosen output steps.

:::warning This tool changes server state
It runs the flow (consuming Tableau Prep Conductor capacity and overwriting outputs) and is **not
idempotent**. Only registered when both `FLOW_TOOLS_ENABLED=true` and
`FLOW_WRITE_TOOLS_ENABLED=true`.
:::

## APIs called

- [Run Flow Task](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#run_flow_task)

## Required Tableau API scopes

- `tableau:flow_tasks:run`
- `tableau:mcp_site_settings:read`

The `tableau:flow_tasks:run` scope was added in Tableau Cloud December 2025 / Server 2025.3.

## Requirements

- Requires **Data Management with Tableau Prep Conductor**; the site's **Run Now** setting must be enabled.
- **Caller-role:** non-administrators can only run flow run tasks they own.

## Required arguments

### `taskId`

The flow run task id from [List Flow Tasks](list-flow-tasks.md) (the task `id`, i.e. the flowRun id).

## Bounded context (fail-closed)

A flow run task carries no project or tag and is addressed only by task id, so when the server is
restricted to an `INCLUDE_PROJECT_IDS` / `INCLUDE_TAGS` bounded context this tool **cannot** verify the
task's flow is in the allowed set and **refuses** (mirroring [List Flow Tasks](list-flow-tasks.md)).
Use [Run Flow](run-flow.md) by flow id in that configuration.

## Response

An object `{ job, mcp: { runStatus } }` — `job.id` (background job id) and
`job.runFlowJobType.flowRunId`. Asynchronous: report it as _started_, then poll
[List Flow Runs](list-flow-runs.md) / [Get Flow](get-flow.md) for the outcome.
