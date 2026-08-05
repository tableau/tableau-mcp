---
sidebar_position: 3
---

# List Flow Runs

Retrieves the run history (executions) of Tableau Prep flows on a site. Each flow run records one
execution attempt with its status, start/finish timestamps, progress, the flow it belongs to, and
the background job id.

This is the dedicated, filterable, site-wide run-history tool:

- [List Flows](list-flows.md) lists flow _definitions_, not executions.
- [Get Flow](get-flow.md) returns recent runs for a **single** flow (as a capped sidecar). Use
  `list-flow-runs` for cross-flow questions ("all failures today") or deeper single-flow history.

## APIs called

- [Get Flow Runs](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#get_flow_runs)
  (requires Tableau REST API >= 3.10)

## Required Tableau API scopes

When the MCP server authenticates with OAuth (connected-app JWT), this tool requests:

- `tableau:flow_runs:read`
- `tableau:flows:read` — to resolve a failed run's flow `webpageUrl` into the run-history deep link
  in `mcp.failureInsight`.
- `tableau:mcp_site_settings:read`

See [OAuth configuration](../../configuration/mcp-config/oauth.md) for how scopes are negotiated.

## Caller-role visibility

- **Non-admin callers** — Tableau returns runs only for flows the caller can **run** (the Execute /
  "Run Flow Now" capability), _not_ flows they can only view. This is stricter than the Tableau web UI
  run-history page (which needs only view permission), so a user may see a flow's runs in the browser
  yet get nothing for that flow here.
- **Server / site-admin callers** — Tableau returns runs for **every** flow on the site, so
  [`mcp.resultInfo.truncated`](#response-shape) is more likely to be `true` on a broad call.

## Optional arguments

### `filter`

A filter expression in the format `field:operator:value`. Multiple expressions are combined with a
comma using a logical AND.

| Field         | Operators              | Notes                                                                       |
| ------------- | ---------------------- | --------------------------------------------------------------------------- |
| `flowId`      | `eq, in`               | Flow LUID (UUID). The most common filter — scope runs to one or more flows. |
| `userId`      | `eq, in`               | LUID of the user who initiated the run.                                     |
| `progress`    | `eq, gt, gte, lt, lte` | Percent complete (0–100).                                                   |
| `startedAt`   | `eq, gt, gte, lt, lte` | ISO 8601 `YYYY-MM-DDTHH:MM:SSZ` or date-only `YYYY-MM-DD` (midnight UTC).   |
| `completedAt` | `eq, gt, gte, lt, lte` | ISO 8601 `YYYY-MM-DDTHH:MM:SSZ` or date-only `YYYY-MM-DD` (midnight UTC).   |
| `status`      | `eq, in`               | One of `Pending, InProgress, Success, Failed, Cancelled`. **Client-side.**  |

Examples:

- `flowId:eq:6f8a2966-e173-11e8-ae74-ffd84c19d7f3`
- `status:eq:Failed,startedAt:gt:2025-01-01`
- `status:in:[Failed,Cancelled]`

#### `status` is applied client-side

The Tableau "Get Flow Runs" endpoint does **not** support filtering runs by `status` server-side
(verified live against REST 3.30). This tool therefore fetches runs using the rest of the filter and
applies `status` in-process. Pair `status` with a `flowId` and/or a `startedAt` window so the
client-side match operates on a bounded set of runs. Unknown `status` values are rejected with the
allowed list, and the value is case-sensitive.

#### `flowId` must be a UUID

`flowId` matches the flow's LUID (canonical 8-4-4-4-12 hex form). The Get Flow Runs endpoint responds
`404` for a `flowId` that does not resolve to a real, visible flow (a flow _name_, or a valid-format
but nonexistent UUID); the tool converts that `404` into an empty result rather than surfacing a raw
HTTP error. When the result is empty and `flowId` is not a UUID, the tool also returns a recovery hint
suggesting a [List Flows](list-flows.md) lookup by name.

#### `in:` — bracket-and-comma form

Multi-value lists use the form `flowId:in:[uuid1,uuid2]` or `status:in:[Failed,Cancelled]`, where
commas separate the items. Items are not quoted, so a single item's value cannot itself contain a
comma (every comma is read as an item separator).

<hr />

### `sort`

A sort expression in the format `field:asc` or `field:desc` using `startedAt` or `completedAt`.

When omitted, the result is ordered **newest first by run recency** — by `completedAt`, falling back
to `startedAt` for runs that haven't completed; runs with neither timestamp (e.g. `Pending`) sort
last. This is a best-effort "most recent" within the returned window.

> **Why the default isn't a plain `startedAt:desc`.** The Tableau Get Flow Runs endpoint orders rows
> whose chosen sort field is _empty_ to the **front** under `:desc`. `startedAt` is empty for every
> never-started run (e.g. `Cancelled`-before-start), so `startedAt:desc` surfaces a stale, unordered
> block of those runs ahead of genuinely recent ones. The tool fetches `completedAt:desc` (a far
> smaller empty band) and then re-orders the fetched window by `completedAt ?? startedAt`. Supplying
> an explicit `sort` is honored verbatim and bypasses this correction.

Example: `completedAt:desc`

<hr />

### `limit`

The maximum number of runs to return. The tool paginates the Tableau endpoint and returns at most
this many runs. When omitted, it falls back to the administrator cap if one is configured; otherwise
it returns the newest **100** runs as a safety backstop (reported as `truncated` with
`truncationReason: "default-cap"`) rather than walking the entire run history. Pass an explicit
`limit` to go beyond the default.

See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit) and
[`MAX_RESULT_LIMITS=list-flow-runs:N`](../../configuration/mcp-config/env-vars.md#max_result_limits).

## Response shape

The tool returns a JSON object:

```json
{
  "flowRuns": [
    /* one record per run, see "Example result" below */
  ],
  "mcp": {
    "resultInfo": {
      "returnedCount": 12,
      "truncated": false
    }
  }
}
```

The top-level `flowRuns` array and `mcp.resultInfo` are **always present**. `resultInfo` reports
whether the returned list is complete:

- `returnedCount` — the number of runs in `flowRuns`.
- `truncated` — `false` means `flowRuns` is the **complete** set matching the request; `true` means
  more matching runs exist on the server than were returned.
- `truncationReason` — present only when `truncated` is `true`:
  - `"requested-limit"` — the caller's own `limit` cut the result short. Call again with a higher
    `limit`.
  - `"default-cap"` — the caller supplied **no `limit`** and **no admin cap** is configured, so the
    tool returned the newest **100** runs as a safety backstop rather than walking the entire run
    history (which accumulates quickly and would load the server). Pass a higher `limit` and/or a
    narrower `filter` (e.g. a single `flowId` or a `startedAt` window) to go deeper.
  - `"admin-cap"` — a site-administrator per-call cap
    ([`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit) or
    `MAX_RESULT_LIMITS=list-flow-runs:N`) cut the result short. Narrow the `filter` (e.g. a tighter
    `startedAt` window or a single `flowId`), or ask the administrator to raise the cap.

Unlike [List Flows](list-flows.md), there is **no `totalAvailable`** — the Tableau Flow Runs
endpoint does not return a total count, so completeness is reported via the `truncated` flag only
(computed with a "+1 probe" — the tool fetches one more run than `limit` to detect that more exist).
When `truncated` is `true`, report "at least N" — never invent a total.

:::tip For client / LLM authors `mcp.resultInfo` is a signal **for the model**, not text to show the
user. Translate it into one plain sentence — "These are all 12 matching runs" or "Here are the first
50; more match" — and never surface the field names to the end user. :::

## Bounded context (fail-closed)

A flow run carries no project or tag, so when the server is restricted to a
[`INCLUDE_PROJECT_IDS`](../../configuration/mcp-config/tool-scoping.md#include_project_ids) or
[`INCLUDE_TAGS`](../../configuration/mcp-config/tool-scoping.md#include_tags) bounded context this tool **cannot** prove
a run belongs to the allowed set. Rather than risk leaking runs for flows outside the allow-list, it
returns no runs and explains why. To inspect a specific allowed flow's run history under a bounded
context, use [Get Flow](get-flow.md) with the flow id (it enforces the bounded context on the flow
itself).

## Limitations

- **No error details for `Failed` runs.** The `status` is available, but the underlying job error
  message is not surfaced by the public Tableau REST API. Inspect the run in the Tableau UI.
- **No exact total-run count.** The endpoint does not expose `totalAvailable`; the tool reports only
  whether more runs exist via `truncated`.

## Example result

```json
{
  "flowRuns": [
    {
      "id": "a1a1a1a1-1111-1111-1111-111111111111",
      "flowId": "d00700fe-28a0-4ece-a7af-5543ddf38a82",
      "status": "Success",
      "startedAt": "2025-04-01T10:00:00Z",
      "completedAt": "2025-04-01T10:05:00Z",
      "progress": 100,
      "backgroundJobId": "b2b2b2b2-2222-2222-2222-222222222222"
    }
  ],
  "mcp": {
    "resultInfo": {
      "returnedCount": 1,
      "truncated": false
    }
  }
}
```
