---
sidebar_position: 8
---

# Run Flow

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

  Runs a Tableau Prep flow **on demand** ("Run Now") through a required two-phase confirmation. The preview describes the run without enqueuing it; the confirmed call enqueues the flow and returns immediately with an async job. The flow executes its output steps (all of them unless you pass `outputStepIds`), writing to its configured outputs.

  Use this tool when the user explicitly wants to **run / refresh / execute** a specific flow right now (by flow id). To run an *existing schedule* now instead, use `run-flow-task`. To only inspect a flow or its runs, use `get-flow` / `list-flow-runs` (read-only).

  **This tool changes server state.** A confirmed run consumes warehouse + Tableau Prep Conductor capacity and overwrites the flow's outputs. Do not confirm until the user has explicitly approved the preview.

  **Two-phase confirmation:**
  1. **Preview** (`confirm` omitted or false): checks the requested run and bounded-context eligibility, starts no run, and returns a single-use confirmation token.
  2. **Run** (`confirm: true`): requires the token from the matching preview. The server verifies and consumes it before enqueuing the flow.

  **Parameters:**
  - `flowId` (required) – The flow to run.
  - `runMode` (optional) – `full` (default) or `incremental`. Incremental only works if the flow's input steps are configured for incremental refresh.
  - `outputStepIds` (optional) – Run only these output steps (ids from `get-flow`). If provided, it must contain at least one id; omit it to run every output step.
  - `parameterOverrides` (optional) – Array of `{ parameterId, overrideValue }` for flows that use parameters. Required parameters must be supplied. Use `get-flow` to discover parameter ids and whether they are required.
  - `confirm` (optional) – Set `true` only after the user approves the preview.
  - `confirmationToken` (optional) – The single-use token returned by the matching preview. Required when `confirm` is true.

  **Response:** Preview returns instructions and a confirmation token. A confirmed call returns `{ job, mcp: { runStatus } }`. `job` includes `id` (background job id) and `runFlowJobType.flowRunId` (the flow run id). The run is asynchronous: report it as *started/queued*, and to check the outcome poll with `list-flow-runs` (filter `flowId:eq:`id``) or `get-flow` (`flowRunLimit: 1`).

  **Requirements & limits:**
  - Requires Tableau REST API version **3.14 or later**. Older Tableau Server versions use a legacy Run Flow request shape that this MCP tool does not send, so the tool refuses instead of risking silently ignored run options or unintended output steps.
  - Requires **Data Management with Tableau Prep Conductor**, and the site's **Run Now** setting must be enabled.
  - **Caller-role:** in addition to admins/project leaders, the flow owner and users granted Run Flow / Execute permission can run a flow. Non-permitted callers get a clear permission error.
  - Not idempotent — each call enqueues another run. A run may be rejected if one is already queued or in progress for the flow.
  - Requires Tableau REST API access scopes `tableau:flows:run`, `tableau:flows:read` (for bounded-context verification), and `tableau:mcp_site_settings:read`.

## APIs called

Talks to Tableau Cloud or Tableau Server.

- 
  Runs a Tableau Prep flow **on demand** ("Run Now") through a required two-phase confirmation.

## Required arguments

### `flowId`

The flowId argument.

## Optional arguments

### `runMode`

The runMode argument.

### `outputStepIds`

The outputStepIds argument.

### `parameterOverrides`

The parameterOverrides argument.

### `confirm`

The confirm argument.

### `confirmationToken`

The confirmationToken argument.

{/* tool-details */}
## Requirements

- Requires Tableau REST API version **3.14 or later**. Older Tableau Server versions use a legacy
  Run Flow request shape that this MCP tool does not send, so the tool refuses instead of risking
  silently ignored run options or unintended output steps.
- Requires **Data Management with Tableau Prep Conductor**, and the site's **Run Now** setting must
  be enabled.
- **Caller-role:** in addition to admins/project leaders, the flow owner and users granted Run Flow
  / Execute permission can run a flow. Non-permitted callers receive a clear permission error.

## Confirmation

The tool is two-phase:

1. **Preview** — omit `confirm` or set it to `false`. The tool checks the requested run and
   bounded-context eligibility, starts no run, and returns a single-use `confirmationToken`.
2. **Run** — set `confirm: true` and pass the token from the matching preview. The server verifies
   and consumes the token before enqueuing the run.

Present the preview to the user and get explicit approval before calling the tool with `confirm: true`.
The token is bound to the flow id, run mode, output steps, and parameter overrides, so changing any
of those values requires a new preview.

## Bounded context (fail-closed)

When the server is restricted to an `INCLUDE_PROJECT_IDS` / `INCLUDE_TAGS` bounded context, the tool
verifies the target flow is in the allowed set (via the flow's project/tags) **before** enqueuing
the run, and refuses otherwise.

## Response

A preview returns instructions and a single-use confirmation token. A confirmed call returns an object
`{ job, mcp: { runStatus } }`:

- `job.id` — the background job id.
- `job.runFlowJobType.flowRunId` — the flow run id.
- `mcp.runStatus` — a reminder that the run is asynchronous.

The run is asynchronous: report it as _started/queued_, then poll
[List Flow Runs](./list-flow-runs.md) (filter `flowId:eq:<id>`) or [Get Flow](./get-flow.md)
(`flowRunLimit: 1`) for the outcome.

## Worked example

```json
{
  "job": {
    "id": "57a8d2f6-899c-4c0f-9b25-fe0d007c5ad0",
    "mode": "Asynchronous",
    "type": "RunFlow",
    "createdAt": "2026-06-26T19:14:08Z",
    "runFlowJobType": {
      "flowRunId": "34b9f6d3-222a-2f2f-6a22-dd2f228a6ff2",
      "flow": {
        "id": "d00700fe-28a0-4ece-a7af-5543ddf38a82",
        "name": "SQLServerUserNamePassword Good"
      }
    }
  },
  "mcp": {
    "runStatus": "The flow run has been queued and is running asynchronously. Use list-flow-runs or get-flow to check its status."
  }
}
```
{/* /tool-details */}
