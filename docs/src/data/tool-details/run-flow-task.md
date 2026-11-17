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
