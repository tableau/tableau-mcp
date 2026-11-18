---
sidebar_position: 6
---

# List Flow Runs

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

  Retrieves the run history (executions) of Tableau Prep flows on a site. Each flow run records one execution attempt with its `status` (Pending, InProgress, Success, Failed, Cancelled), `startedAt`/`completedAt` timestamps, `progress`, the `flowId` it belongs to, the `backgroundJobId`, and — on `Failed` runs, REST API 3.30+ — a `failureReason` giving the cause. Use this tool to answer questions about flow execution outcomes — e.g. "why did my flow fail", "which flows failed recently and why", "show the run history for flow X", "what's still running".

  **This vs. get-flow / list-flows**
  - `list-flows` lists flow *definitions* (metadata), not executions.
  - `get-flow` returns recent runs for ONE flow (capped, as a sidecar). `list-flow-runs` is the dedicated, filterable, site-wide run history — use it for cross-flow questions ("all failures today") or deeper single-flow history.

  **What a run record does NOT include**
  - **Failure reason — mostly now available.** On Tableau REST API **3.30+**, a `Failed` run carries `failureReason: { available, message }` giving the cause directly, readable by any caller (it comes from the flow's output-step errors, not the admin-only background job). Residual gaps: (1) only `Failed` runs get one — there is nothing for `Cancelled`, and nothing that explains why a run is slow or stuck `InProgress`; (2) `message` is a short localized reason, NOT a stack trace or job log — the full job detail behind `backgroundJobId` still requires **site-administrator** access (and `backgroundJobId` is populated only for recent runs); (3) `available: false` means Tableau could not determine the cause and `message` is a generic placeholder. On servers **below 3.30** the field is absent entirely. Whenever a reason is missing or unresolved, the tool falls back to a **run-history deep link** in `mcp.failureInsight` — open it in Tableau to read the error there (see Response Shape).
  - **Trigger origin:** a run does not record whether it was started by a *schedule* or *ad-hoc / on-demand*, and there is no field to filter scheduled-only runs. To see which flows have schedules, use `list-flow-tasks`.

  **Caller-role visibility**
  - **Non-admin** callers get runs only for flows they can *run* — flows on which they hold the **Execute** ("Run Flow Now") capability (as owner, via an explicit or group grant, or inherited from the project). A flow the caller can only *view* (Read) but not run returns NO runs here. NOTE: this is stricter than the Tableau web UI's run-history page (which needs only view permission), so a user may see a flow's runs in the browser yet get nothing for that flow from this tool.
  - **Admin** callers (site or server) get runs for every flow on the site, so `mcp.resultInfo.truncated` is more likely `true` on a broad call.

  **Response Shape**
  Returns a JSON object `{ flowRuns: [...], mcp: { resultInfo: {...} } }`. `mcp.resultInfo` is ALWAYS present and reports completeness:
  - `returnedCount` — number of runs in `flowRuns`.
  - `truncated` — `false` means `flowRuns` is the COMPLETE set matching the request; `true` means more matching runs exist on the server than were returned.
  - `truncationReason` (only when `truncated` is `true`):
      - `"requested-limit"` — your `limit` cut the result short; call again with a higher `limit` for more.
      - `"default-cap"` — you supplied no `limit` and no admin cap is set, so the tool returned the newest 100 runs as a safety default (flow runs can be very numerous); pass a higher `limit` and/or a narrower `filter` to get more.
      - `"admin-cap"` — a site-administrator per-call cap (`MAX_RESULT_LIMIT[S]`) cut it short; narrow the `filter` (e.g. a tighter `startedAt` window or a single `flowId`) or ask an admin to raise the cap.
  - There is NO `totalAvailable` — the Tableau Flow Runs endpoint does not return a total count. When `truncated` is `true`, report "at least N" (never invent a total).
  - `mcp.failureSummary` (present when the window's `Failed` runs carry a `failureReason`, i.e. REST API 3.30+): the window's failures grouped by reported message and availability so you can tell one systemic problem from many unrelated ones. Fields:
      - `failedRunCount` — number of `Failed` runs in the returned window.
      - `failedFlowCount` — number of DISTINCT flows with a failure in that window.
      - `reasons` — one entry per distinct `{ message, available }` pair, biggest first: `{ message, available, runCount, flowIds }`. `runCount` is how many runs reported that pair and `flowIds` are the DISTINCT flows it affected (its blast radius). A group is not always a single root cause: Tableau reports a short localized message, and different underlying errors can share one (e.g. a flow-execution failure and an authentication failure both surface as "Flow processing error"), so treat a group as one symptom that may have more than one cause. `available: false` means the cause could not be determined and `message` is a generic placeholder — do NOT present it as a diagnosis. Unresolved groups are common and often the largest; to investigate one, call `get-flow` on any of its `flowIds` and append `/runHistory` to the returned `webpageUrl` to get that flow's run-history page.
      - Because the top-level counts cover ALL `Failed` runs while `reasons` covers only those carrying a reason, `sum(reasons[].runCount)` can be less than `failedRunCount`.
  - `mcp.failureInsight` (the FALLBACK, present when the window has a `Failed` run that nothing can explain — no `failureReason`, or none with `available: true`): a pointer to investigate in the Tableau UI. Fields:
      - `failedRunCount` / `failedFlowCount` — as above, and always equal to `failureSummary`'s when both fields are present.
      - `example` (when resolvable) — `{ flowId, runHistoryUrl }` for ONE affected flow (the most-recent failure); open `runHistoryUrl` in a browser and expand the failed run to read why it failed.
  - **The two can co-occur.** `failureSummary` appears whenever a reason exists; `failureInsight` is added whenever none resolves. So a window whose reasons are ALL `available: false` carries both — treat the summary as a count of what failed and the link as where the cause actually lives. In a MIXED window (some reasons resolved, some not) `failureInsight` is deliberately absent, so an `available: false` group there has no link of its own — use the `get-flow` route above to reach one.

  **Reporting to the user (every call):** translate `mcp.resultInfo` into one plain sentence — never say "resultInfo". `truncated:false` → "these are all N matching runs". `"requested-limit"` → "here are N; more match — say if you want the rest". `"default-cap"` → "here are the newest N; more runs exist — say if you want a larger set (or narrow by flow/date)". `"admin-cap"` → "here are N; a site limit caps results per call — I can narrow the search, or an admin can raise the cap". When `mcp.failureSummary` is present, lead with the biggest cause with `available: true` and its `runCount` ("38 of the 43 failures are `message`"), and when one reason's `flowIds` covers several flows say so — that shared cause is usually the thing worth fixing first. For a reason with `available: false`, say the cause could not be determined and never repeat the placeholder `message` as if it were the diagnosis; when no `mcp.failureInsight` accompanies it, offer to fetch that group's run-history link (`get-flow` on one of its `flowIds`, then `webpageUrl` + `/runHistory`) instead of only naming Tableau. When `mcp.failureInsight` is present, note that these failures have no resolved reason from the API but are viewable in Tableau, and share `example.runHistoryUrl`; if `failedFlowCount` ` 1, add that this link is for one of N affected flows and offer to fetch the others (resolve each via `get-flow`). When BOTH fields are present, every reason in the window is a placeholder: give the counts from `failureSummary` and send the user to `example.runHistoryUrl` for the cause — do not present a placeholder `message` as the answer. When `truncated` is `true`, `failedRunCount` and `failedFlowCount` describe ONLY the returned window — present them as "N in this window", never as a site-wide failure count or rate. Also surface the **Caller-role visibility** limit when presenting results: these runs cover ONLY flows the user can *run* (the Execute / "Run Flow Now" capability), not flows they can only view — so a flow they can see in the Tableau web UI may be missing here. Call this out especially on empty or unexpectedly short results, or when the user asks for "all" failures. (Site/server administrators are exempt — they get runs for every flow, so do not state this limit to an admin caller.)

  **Response-Size Guidance** — flow runs accumulate quickly on active sites, so favour narrow calls:
  - Single-flow history: `filter: "flowId:eq:`uuid`"` (+ optional `limit`).
  - Recent failures: `filter: "status:eq:Failed,startedAt:gt:2025-01-01"`.
  - With no `limit` and no admin cap, the tool returns the newest 100 runs (`truncated:true`, `truncationReason:"default-cap"`) instead of the full history; pass a higher `limit` to go deeper.

  **Supported Filter Fields and Operators**
  | Field       | Operators            | Notes |
  |-------------|----------------------|-------|
  | flowId      | eq, in               | Flow LUID (UUID). Most common filter — scope runs to one or more flows. |
  | userId      | eq, in               | LUID of the user who initiated the run. |
  | progress    | eq, gt, gte, lt, lte | Percent complete (0–100). |
  | startedAt   | eq, gt, gte, lt, lte | ISO 8601 `YYYY-MM-DDTHH:MM:SSZ`, OR date-only `YYYY-MM-DD` (auto-promoted to midnight UTC). |
  | completedAt | eq, gt, gte, lt, lte | ISO 8601 `YYYY-MM-DDTHH:MM:SSZ`, OR date-only `YYYY-MM-DD` (auto-promoted to midnight UTC). |
  | status      | eq, in               | One of Pending, InProgress, Success, Failed, Cancelled. |

  **Filter value contracts** (mismatches return 0 runs):
  - `flowId` must be the flow UUID; a flow name (or any id that doesn't resolve to a visible flow) returns no runs and the tool hints toward list-flows.
   - `status` values are case-sensitive and must be one of the five exact values above; an unknown value is rejected with the allowed list. On REST API 3.30+, a multi-value `in` may contain only terminal statuses (Success, Failed, Cancelled), matching the REST API contract.
  - `in:` lists use bracket/comma form, e.g. `flowId:in:[uuid1,uuid2]` or `status:in:[Failed,Cancelled]` (unquoted; commas inside items unsupported).

  **Supported operators**

  - `eq`: equals
  - `gt`: greater than
  - `gte`: greater than or equal
  - `in`: any of a list (for searching tags)
  - `lt`: less than
  - `lte`: less than or equal

  Filter expressions cannot contain `&` or `,`, even encoded. Operators are delimited with colons, for example `filter=name:eq:Project Views`. Field names, operators, and values are case-sensitive. Combine fields with a comma, which means AND; if the same field appears twice, only the last reference is used. Date-time values use ISO 8601. Wildcards: `name:eq:mark*` starts with, `name:eq:*-ample` ends with, `name:eq:mark*ex*` contains.

  **Sort Expression**
  - Default (no `sort`): newest first by run recency — ordered by `completedAt`, falling back to `startedAt` for runs that haven't completed; runs with neither timestamp (e.g. `Pending`) sort last. This is a best-effort "most recent" within the returned window.
  - Override with an explicit `sort`, e.g. `completedAt:desc` or `startedAt:asc`. NOTE: the Tableau API orders runs whose chosen field is empty FIRST under `:desc`, so an explicit `startedAt:desc` surfaces never-started runs (e.g. some Cancelled) ahead of genuinely recent ones — prefer the default for "latest runs".

  **Example Usage:**
  - Run history for one flow, newest first: filter: "flowId:eq:6f8a2966-e173-11e8-ae74-ffd84c19d7f3"
  - Recent failures across all flows: filter: "status:eq:Failed,startedAt:gt:2025-01-01"
  - In-progress runs right now: filter: "status:eq:InProgress"

## APIs called

Talks to Tableau Cloud or Tableau Server.

- 
  Retrieves the run history (executions) of Tableau Prep flows on a site.

## Optional arguments

### `filter`

The filter argument.

### `sort`

The sort argument.

:::note
Sorting by `status:asc` or `status:desc` is refused when the connected server's Tableau REST API is older than 3.30. Sorting flow runs by status requires Tableau REST API version 3.30 or later. Use startedAt, completedAt, or progress sorting on older servers.
:::

### `limit`

The limit argument.

{/* tool-details */}
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
{/* /tool-details */}
