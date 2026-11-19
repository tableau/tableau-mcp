## Caller-role visibility

- **Non-admin callers** — Tableau returns runs only for flows the caller can **run** (the Execute /
  "Run Flow Now" capability), _not_ flows they can only view. This is stricter than the Tableau web
  UI run-history page (which needs only view permission), so a user may see a flow's runs in the
  browser yet get nothing for that flow here.
- **Server / site-admin callers** — Tableau returns runs for **every** flow on the site, so
  [`mcp.resultInfo.truncated`](#response-shape) is more likely to be `true` on a broad call.

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

Unlike [List Flows](./list-flows.md), there is **no `totalAvailable`** — the Tableau Flow Runs
endpoint does not return a total count, so completeness is reported via the `truncated` flag only
(computed with a "+1 probe" — the tool fetches one more run than `limit` to detect that more exist).
When `truncated` is `true`, report "at least N" — never invent a total.

:::tip[For client / LLM authors]

`mcp.resultInfo` is a signal **for the model**, not text to show the
user. Translate it into one plain sentence — "These are all 12 matching runs" or "Here are the first
50; more match" — and never surface the field names to the end user.

## Failure reporting

When the returned window contains a `Failed` run, the tool reports on it through up to two fields.
`mcp.failureSummary` appears whenever a `Failed` run carries a reason; `mcp.failureInsight` is **added**
whenever no reason resolves the failure. They therefore co-occur when every reason in the window is
`available: false` — the summary counts the failures, the link is where the cause can actually be read.

### `mcp.failureSummary`

Present when the window's `Failed` runs carry a `failureReason` (Tableau REST API >= 3.30). It groups
the window's failures by the reported message and whether Tableau marked the reason available, so a
caller can tell one systemic problem from many unrelated ones without reading every record:

- `failedRunCount` — `Failed` runs in the returned window.
- `failedFlowCount` — **distinct** flows with a failure in that window.
- `reasons` — one entry per distinct `{ message, available }` pair, largest first, as
  `{ message, available, runCount, flowIds }`. `runCount` is how many runs reported that pair, and
  `flowIds` lists the **distinct** flows it affected (its blast radius).

A group is not always a single root cause. Tableau reports a short localized message, and several
distinct underlying errors can map to the same one — a flow-execution failure and an authentication
failure both surface as `Flow processing error`, for example. The underlying error identifier is not
exposed by the REST API, so treat a group as one **symptom**, which may have more than one cause.
- `available: false` means Tableau could not determine the cause and `message` is a generic
  placeholder. Do not present it as a diagnosis. Unresolved groups are common on real sites, and are
  often the largest — to investigate one, call [Get Flow](./get-flow.md) on any of its `flowIds` and
  append `/runHistory` to the returned `webpageUrl`.

`failedRunCount` and `failedFlowCount` cover **all** `Failed` runs, while `reasons` covers only those
carrying a reason, so `sum(reasons[].runCount)` can be less than `failedRunCount`. Both counts
describe the returned window only — when `truncated` is `true` they are not site-wide failure totals
or rates.

### `mcp.failureInsight`

The fallback, for failures that cannot explain themselves — either the server predates REST API 3.30
(no `failureReason` at all) or every reason returned has `available: false`. It carries the same
`failedRunCount` / `failedFlowCount` (identical values, since both fields count the same window), plus
an `example` of `{ flowId, runHistoryUrl }` for one affected flow (the most-recent failure) when
resolvable. Open `runHistoryUrl` in a browser and expand the failed run to read the error in the
Tableau UI.

Only one flow is resolved, which costs one extra
[Query Flow](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#query_flow)
call; use [Get Flow](./get-flow.md) to resolve the others if `failedFlowCount` is greater than 1.

In a **mixed** window — some reasons resolved, some not — this field is deliberately absent, since the
resolved reasons already answer the question and the link would cost that extra call. An
`available: false` group in such a window therefore has no link of its own; reach one through
[Get Flow](./get-flow.md) as described above.

## Bounded context (fail-closed)

A flow run carries no project or tag, so when the server is restricted to a
[`INCLUDE_PROJECT_IDS`](../../configuration/mcp-config/tool-scoping.md#include_project_ids) or
[`INCLUDE_TAGS`](../../configuration/mcp-config/tool-scoping.md#include_tags) bounded context this
tool **cannot** prove a run belongs to the allowed set. Rather than risk leaking runs for flows
outside the allow-list, it returns no runs and explains why. To inspect a specific allowed flow's
run history under a bounded context, use [Get Flow](./get-flow.md) with the flow id (it enforces the
bounded context on the flow itself).

## Limitations

- **Failure reasons need REST API >= 3.30, and only cover `Failed` runs.** On older servers
  `failureReason` is absent entirely and the tool falls back to the
  [`mcp.failureInsight`](#mcpfailureinsight) deep link. Even on 3.30+, there is no reason for a
  `Cancelled` run and nothing explaining why a run is slow or stuck `InProgress`.
- **A reason is a short message, not a log.** `failureReason.message` is a short localized cause. The
  full underlying job error is not surfaced by the public REST API and reading it requires
  site-administrator access to the job behind `backgroundJobId`. Inspect the run in the Tableau UI for
  the detail.
- **No exact total-run count.** The endpoint does not expose `totalAvailable`; the tool reports only
  whether more runs exist via `truncated`.

## Worked example

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

With a failure, on Tableau REST API >= 3.30:

```json
{
  "flowRuns": [
    {
      "id": "a2a2a2a2-2222-2222-2222-222222222222",
      "flowId": "d00700fe-28a0-4ece-a7af-5543ddf38a82",
      "status": "Failed",
      "startedAt": "2025-04-02T10:00:00Z",
      "completedAt": "2025-04-02T10:01:00Z",
      "progress": 100,
      "backgroundJobId": "b3b3b3b3-3333-3333-3333-333333333333",
      "failureReason": {
        "available": true,
        "message": "Table \"orders\" was not found."
      }
    }
  ],
  "mcp": {
    "resultInfo": {
      "returnedCount": 1,
      "truncated": false
    },
    "failureSummary": {
      "failedRunCount": 1,
      "failedFlowCount": 1,
      "reasons": [
        {
          "message": "Table \"orders\" was not found.",
          "available": true,
          "runCount": 1,
          "flowIds": ["d00700fe-28a0-4ece-a7af-5543ddf38a82"]
        }
      ]
    }
  }
}
```

On a server below REST API 3.30 the same window has no `failureReason` and the tool returns the deep
link instead:

```json
{
  "mcp": {
    "resultInfo": {
      "returnedCount": 1,
      "truncated": false
    },
    "failureInsight": {
      "failedRunCount": 1,
      "failedFlowCount": 1,
      "example": {
        "flowId": "d00700fe-28a0-4ece-a7af-5543ddf38a82",
        "runHistoryUrl": "https://my.tableau.example.com/#/site/mysite/flows/96151/runHistory"
      }
    }
  }
}
```
