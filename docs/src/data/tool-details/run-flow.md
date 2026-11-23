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
