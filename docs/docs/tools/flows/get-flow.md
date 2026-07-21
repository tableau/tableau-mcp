---
sidebar_position: 2
---

# Get Flow

Retrieves detailed information about a specific Tableau Prep flow, including its output steps and
optionally its input data connections and recent flow runs.

## APIs called

- [Query Flow](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#query_flow)
- [Query Flow Connections](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#query_flow_connections)
  (optional)
- [Get Flow Runs](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#get_flow_runs)
  (optional, requires Tableau REST API >= 3.10)

## Required Tableau API scopes

When the MCP server authenticates with OAuth (connected-app JWT), this tool requests at most:

- `tableau:flows:read` (always)
- `tableau:mcp_site_settings:read` (always)
- `tableau:flow_connections:read` (only when `includeConnections: true`)
- `tableau:flow_runs:read` (only when `includeFlowRuns: true`)

The sidecar scopes are requested **only** for the sidecars you ask for, so a metadata-only call
(`includeConnections: false, includeFlowRuns: false`) succeeds against a connected app that grants
just `tableau:flows:read` (plus the always-on site-settings scope). Flows use the dedicated
`tableau:flows:read` scope, not the `tableau:content:read` scope used by workbooks, data sources,
and views. See [OAuth configuration](../../configuration/mcp-config/oauth.md) for details.

## Required arguments

### `flowId`

The ID of the flow, potentially retrieved by the [List Flows](list-flows.md) tool.

Example: `d00700fe-28a0-4ece-a7af-5543ddf38a82`

## Optional arguments

### `includeConnections`

When `true` (default), additionally returns the input data connections for the flow.

If the connections sidecar call fails (e.g. permissions error), the tool still returns the flow
metadata and emits a warning under `mcp.warnings` instead of failing the entire call.

When `false`, the tool also **narrows the Tableau API scopes requested at JWT sign-in** — it does
not request `tableau:flow_connections:read`. This means a metadata-only call succeeds against a
Connected App that grants only `tableau:flows:read`, even when the operator chose not to grant the
optional sidecar scopes. If both `includeConnections` and `includeFlowRuns` are `false`, the JWT
requests only `tableau:flows:read` plus the always-on site-settings scope.

### `includeFlowRuns`

When `true` (default), additionally returns the most recent flow runs for this flow.

Requires Tableau REST API version 3.10 (Tableau Server 2020.4) or later. On older servers, this
sidecar call is skipped and a `VERSION_GATE_SKIPPED` warning is emitted under `mcp.warnings`.

When `false`, the tool also **narrows the Tableau API scopes requested at JWT sign-in** — it does
not request `tableau:flow_runs:read`. See `includeConnections` above for the metadata-only
deployment story.

### `flowRunLimit`

The maximum number of recent flow runs to return when `includeFlowRuns` is `true`. Must be between 1
and 100. Default: `10`. Runs are sorted by `startedAt` descending (newest first).

When the flow has more historical runs than this limit, the tool returns the most-recent slice and
emits a [`FLOW_RUNS_TRUNCATED`](#run-history-truncation-flow_runs_truncated) warning under
`mcp.warnings`. **There is no other signal in the response that distinguishes a truncated history
from a complete one** — always inspect `mcp.warnings` before reporting "complete history" to the
user.

## Response-size guidance

By default this tool returns metadata + output steps + all connections + the 10 most-recent runs.
Each sidecar adds payload, so the tool description steers the LLM toward the narrowest call that
answers the user's question:

| Question shape                              | Recommended arguments                               |
| ------------------------------------------- | --------------------------------------------------- |
| "What is this flow?" (just metadata)        | `includeConnections: false, includeFlowRuns: false` |
| "What does this flow read from?"            | `includeFlowRuns: false` (keep `connections`)       |
| "Did the latest run succeed?" (status only) | `flowRunLimit: 1` (or 3)                            |
| "Show me the run history"                   | `flowRunLimit: <n>` up to 100                       |

When in doubt, prefer the lower limit — the LLM can always re-call with a higher limit if the first
response is insufficient.

## Partial failure (`mcp.warnings`)

The primary
[Query Flow](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#query_flow)
call is atomic; if it fails, the tool returns an error.

The optional `connections` and `flowRuns` sidecars are best-effort. If either of them fails (for
example, the user lacks permission, the server is too old, or the request times out) the tool will
still return the flow's primary metadata and surface a structured warning instead of failing the
whole tool call. The tool can emit three warning types:

### `SIDECAR_FETCH_FAILED`

```json
{
  "type": "SIDECAR_FETCH_FAILED",
  "severity": "WARNING",
  "message": "Failed to fetch connections: HTTP 403 Forbidden",
  "affectedField": "connections",
  "httpStatus": "403"
}
```

### `VERSION_GATE_SKIPPED`

Emitted when `includeFlowRuns: true` but the Tableau server is older than REST API 3.10 (Tableau
Server 2020.4):

```json
{
  "type": "VERSION_GATE_SKIPPED",
  "severity": "WARNING",
  "message": "Flow runs require Tableau REST API 3.10 or later; this server is older.",
  "affectedField": "flowRuns"
}
```

### Run-history truncation (`FLOW_RUNS_TRUNCATED`)

Emitted when the flow has more runs than `flowRunLimit`. The `flowRuns` array contains the
most-recent slice; older runs exist but are NOT in the response.

```json
{
  "type": "FLOW_RUNS_TRUNCATED",
  "severity": "WARNING",
  "message": "Returned the 10 most-recent flow runs (sorted startedAt desc). The flow has additional historical runs not included in this response. To see more runs: 1. Re-call this tool with a higher `flowRunLimit` (max 100). 2. For deeper history (more than 100 runs) use the Tableau Flow Runs REST API directly with `filter=flowId:eq:<id>` and `pageNumber` pagination, or with a date-range filter (e.g. `startedAt:gt:<iso-timestamp>`).",
  "affectedField": "flowRuns",
  "returnedCount": 10
}
```

**Why this warning exists.** The Tableau Flow Runs endpoint (`GET /sites/{site}/flows/runs`) does
not return a `pagination` block, so the tool cannot read `totalAvailable` to know whether the
response was truncated. Instead it uses the **"+1 probe"** technique: request `flowRunLimit + 1`
rows in a single call; if more than `flowRunLimit` come back, the array was truncated and this
warning is emitted (verified live against Tableau REST 3.30).

**Recovery actions.** When you see this warning:

1. If the user wants more recent context, re-call with a higher `flowRunLimit` (up to 100).
2. If the user wants deeper history (more than 100 runs, or a specific date range), this tool cannot
   satisfy it in v0. Recommend the user query the Tableau Flow Runs REST API directly with
   `filter=flowId:eq:<id>` and `pageNumber` pagination, or with a date-range filter such as
   `startedAt:gt:2025-01-01T00:00:00Z`.

**Anti-patterns.** Do NOT confidently report a partial run history (e.g. "this flow has run 10
times") when this warning is present — the response is a window onto a longer history, not the
complete record. Daily-running production flows can easily accumulate hundreds of runs per year.

## Limitations

A few things this tool deliberately does **not** expose in the current version:

- **No error details for `Failed` flow runs.** The `flowRuns[*].status` field is available (e.g.
  `Success`, `Failed`, `Cancelled`), but the underlying job error message is not surfaced by the
  public Tableau REST API and is therefore not exposed here. To investigate a failure, inspect the
  run in the Tableau Server / Cloud UI.
- **No per-output-step run details.** The `flowRuns` field reflects ad-hoc runs returned by the
  public REST API; per-output-step success/failure breakdowns and timings are not included.
- **No exact total-run count.** Tableau's Flow Runs endpoint does not expose a `totalAvailable`
  field, so the tool cannot report exactly how many runs exist beyond what was returned — only
  whether more do, via the [`FLOW_RUNS_TRUNCATED`](#run-history-truncation-flow_runs_truncated)
  warning. For deeper history queries, see the recovery actions on that warning.

## Example result

```json
{
  "id": "d00700fe-28a0-4ece-a7af-5543ddf38a82",
  "name": "Sales Cleanup",
  "description": "Cleans up the daily sales feed",
  "webpageUrl": "https://10ax.online.tableau.com/#/site/mcp-test/flows/3",
  "fileType": "tflx",
  "createdAt": "2024-11-06T04:57:55Z",
  "updatedAt": "2024-11-06T21:31:00Z",
  "project": {
    "id": "6f8a2966-e173-11e8-ae74-ffd84c19d7f3",
    "name": "Default",
    "description": "The default project that was automatically created by Tableau."
  },
  "owner": {
    "id": "711e59cf-d1c0-446e-be48-3673ae067f7b",
    "name": "jane.doe@example.com",
    "fullName": "Jane Doe",
    "email": "jane.doe@example.com",
    "siteRole": "Creator"
  },
  "tags": { "tag": [{ "label": "sales" }] },
  "outputSteps": [{ "id": "5e4c9a74-d29a-4f62-baa5-97c443440dfc", "name": "CoffeeChainOutputCSV" }],
  "connections": [
    {
      "id": "5fd1c1db-572f-4ebd-94e7-a09e212bc147",
      "type": "sqlserver",
      "serverAddress": "mySQLServer",
      "userName": "analyst",
      "embedPassword": true
    }
  ],
  "flowRuns": [
    {
      "id": "a1a1a1a1-1111-1111-1111-111111111111",
      "flowId": "d00700fe-28a0-4ece-a7af-5543ddf38a82",
      "status": "Success",
      "startedAt": "2025-04-01T10:00:00Z",
      "completedAt": "2025-04-01T10:05:00Z",
      "progress": 100
    }
  ]
}
```
