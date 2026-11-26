---
sidebar_position: 3
---

# Cancel Flow Run

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

  Requests cancellation of a **queued or in-progress Tableau Prep flow run**, by flow *run* id (not flow id). This is the counterpart to `run-flow` / `run-flow-task`: use it for a run you started that has not reached a terminal state. The request may be accepted while the run is executing, but the final status can still be Completed or Failed if the run is already finishing.

  Get the `flowRunId` from `run-flow` / `run-flow-task` (`job.runFlowJobType.flowRunId`) or from `list-flow-runs`. To only inspect runs, use `list-flow-runs` / `get-flow` (read-only).

  **This tool changes server state.** Cancellation is **asynchronous**:
  - The cancellation request may take several seconds to settle while the server reconciles the run's terminal status.
  - If the run is already in its **final output-write phase**, those writes may complete and the final status may be Completed or Failed rather than Cancelled. Cancellation does not undo writes.
  - It does **not** alter the flow definition or its schedule — it requests cancellation for one run.

  **Two-phase confirmation:**
  1. **Preview** (`confirm` omitted or false): describes the cancellation request without contacting Tableau and returns a short-lived confirmation token bound to this change.
  2. **Cancel** (`confirm: true`): requires the token from the matching preview before requesting cancellation.

  **Parameters:**
  - `flowRunId` (required) – The id of the flow run to cancel.
  - `confirm` (optional) – Set `true` only after the user approves the preview.
  - `confirmationToken` (optional) – The short-lived token returned by the matching preview. Required when `confirm` is true.

  **Response:** Preview returns instructions and a confirmation token. A confirmed call returns `{ mcp: { cancelStatus } }`. Report the cancel as *requested*. Use `list-flow-runs` to confirm the final status; retain the associated flow id when narrowing the query.

  **Requirements & limits:**
  - **Caller-role:** in addition to site/server administrators, you can cancel a flow run only if you **initiated the run** (or created its scheduled task) **and** have Run Flow permission on the flow. Non-permitted callers get a clear permission error.
  - Requires Tableau REST API version **3.10 or later**.
  - Not idempotent: cancelling a run that has **already completed** fails with Tableau error 403135 (nothing to cancel) — check `list-flow-runs` rather than retrying. It also fails if a site administrator has **disabled flow-run cancellation** for the site.
  - **Bounded-context note:** when this MCP server is restricted to specific projects/tags, this tool cannot verify that the flow run's flow is in the allowed set (a run is addressed only by run id), so it refuses — mirroring `run-flow-task`.
  - Requires Tableau REST API access scopes `tableau:flow_runs:update` and `tableau:mcp_site_settings:read`.

## APIs called

Talks to Tableau Cloud or Tableau Server.

- 
  Requests cancellation of a **queued or in-progress Tableau Prep flow run**, by flow *run* id (not flow id).

## Required arguments

### `flowRunId`

The flowRunId argument.

## Optional arguments

### `confirm`

The confirm argument.

### `confirmationToken`

The confirmationToken argument.

{/* tool-details */}
## Two-phase confirmation

1. **Preview** (default, with `confirm` omitted or `false`): describes the cancellation request
   without contacting Tableau and returns a short-lived `confirmationToken` bound to this change.
2. **Cancel** (`confirm: true`): requires the token from a matching preview. Present the proposed
   cancellation to the user and get explicit approval before making the confirmed call.

## Requirements

- Requires Tableau REST API version **3.10 or later**
- **Caller-role:** in addition to site/server administrators, you can cancel a flow run only if you
  **initiated the run** (or created its scheduled task) **and** have Run Flow permission on the flow.
- Not idempotent: cancelling a run that has **already completed** fails with Tableau error 403135
  (nothing to cancel), so check [List Flow Runs](./list-flow-runs.md) instead of retrying. It also
  fails if a site administrator has
  **disabled flow-run cancellation** for the site

## Bounded context (fail-closed)

A flow run carries no project or tag and is addressed only by run id, so when the server is restricted
to an `INCLUDE_PROJECT_IDS` / `INCLUDE_TAGS` bounded context this tool **cannot** verify the run's flow
is in the allowed set and **refuses** (mirroring [Run Flow Task](./run-flow-task.md)).

## Response

An object `{ mcp: { cancelStatus } }`. Report the cancel as _requested_, then confirm the final state
with [List Flow Runs](./list-flow-runs.md) / [Get Flow](./get-flow.md).
{/* /tool-details */}
