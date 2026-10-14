---
sidebar_position: 7
---

# Cancel Flow Run

Requests cancellation of a **queued or in-progress Tableau Prep flow run**, by flow _run_ id (not flow id).
This is the counterpart to [Run Flow](run-flow.md) / [Run Flow Task](run-flow-task.md): use it for a
run you started that has not reached a terminal state. The request may be accepted while the run is
executing, but the final status can still be Completed or Failed if the run is already finishing.

The tool uses a required two-phase confirmation: preview first, then confirm the exact cancellation
request with the single-use token returned by the preview. The confirmed call is the only phase that
requests cancellation.

Get the `flowRunId` from [Run Flow](run-flow.md) / [Run Flow Task](run-flow-task.md)
(`job.runFlowJobType.flowRunId`) or from [List Flow Runs](list-flow-runs.md).

:::warning This tool changes server state
Cancellation is **asynchronous**:

- The server may take several seconds to settle the final status after the cancellation request.
- If the run is already in its **final output-write phase**, those writes may complete and the final
  status may be Completed or Failed rather than Cancelled. Cancellation does **not** undo writes.
- It does **not** alter the flow definition or its schedule — it requests cancellation for one run.

Only registered when both `FLOW_TOOLS_ENABLED=true` and `FLOW_WRITE_TOOLS_ENABLED=true`.

## Two-phase confirmation

1. **Preview** (default, with `confirm` omitted or `false`): describes the cancellation request
   without contacting Tableau and returns a single-use `confirmationToken`.
2. **Cancel** (`confirm: true`): requires the token from a matching preview. Present the proposed
   cancellation to the user and get explicit approval before making the confirmed call.
:::

## APIs called

- [Cancel Flow Run](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#cancel_flow_run)

## Required Tableau API scopes

- `tableau:flow_runs:update`
- `tableau:mcp_site_settings:read`

## Requirements

- Requires Tableau REST API version **3.10 or later**
- **Caller-role:** in addition to site/server administrators, you can cancel a flow run only if you
  **initiated the run** (or created its scheduled task) **and** have Run Flow permission on the flow.
- Fails if the run has **already completed** (nothing to cancel), or if a site administrator has
  **disabled flow-run cancellation** for the site

## Required arguments

### `flowRunId`

The id of the flow run to cancel.

### `confirm`

Set to `true` only after the user explicitly approves the preview. Omit it, or set it to `false`, to
run the non-destructive preview.

### `confirmationToken`

The single-use token returned by a matching preview. Required when `confirm` is `true`.

## Bounded context (fail-closed)

A flow run carries no project or tag and is addressed only by run id, so when the server is restricted
to an `INCLUDE_PROJECT_IDS` / `INCLUDE_TAGS` bounded context this tool **cannot** verify the run's flow
is in the allowed set and **refuses** (mirroring [Run Flow Task](run-flow-task.md)).

## Response

An object `{ mcp: { cancelStatus } }`. Report the cancel as _requested_, then confirm the final state
with [List Flow Runs](list-flow-runs.md) / [Get Flow](get-flow.md).
