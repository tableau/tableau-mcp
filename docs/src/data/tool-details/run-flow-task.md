## Two-phase confirmation

1. **Preview** (default, with `confirm` omitted or `false`): describes the task run without
   enqueuing it and returns a short-lived `confirmationToken` bound to this change.
2. **Run** (`confirm: true`): requires the token from a matching preview. Present the proposed run to
   the user and get explicit approval before making the confirmed call.

The token is bound to the task id and to a fingerprint of the task's flow's 10 most recent run ids.
Each phase makes two extra REST calls: Get Flow Run Task (to resolve the task's flow) and Get Flow
Runs. If a new run appears between preview and confirm, the confirmation is rejected and a new
preview is needed; an existing run that only changes status does not reject it. If either lookup fails, or the task has no
resolvable flow, no token is issued and nothing runs.

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
