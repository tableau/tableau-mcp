---
sidebar_position: 7
---

# List Flow Tasks

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

  Retrieves the scheduled flow run tasks on a Tableau site. A flow run task is the **schedule** for a Tableau Prep flow — when and how often it is configured to run — NOT a record of past executions (for run history use the `list-flow-runs` tool). Each task includes the target flow (`flow.id`, `flow.name`), the schedule (frequency, next run time, state), and the task `id` used to trigger an on-demand run.

  Use this tool to answer questions like:
  - "Which flows are scheduled, and how often do they run?"
  - "When does flow X run next?"
  - "Are any flow schedules suspended / failing repeatedly?"

  **Caller-role visibility**
  - **Non-admin** callers get the scheduled tasks only for flows they own.
  - **Admin** callers get every scheduled flow task on the site.

  **Parameters:**
  - `filter` (optional) – Client-side filter string `field:operator:value`. Multiple filters are comma-separated (AND logic). The Tableau REST API does not support server-side filtering for this endpoint, so all tasks are fetched and filtered client-side.
  - `pageSize` (optional) – Maximum results per page (client-side, applied after filtering).
  - `limit` (optional) – Maximum total results to return (client-side, applied after filtering).

  **Response-Size Guidance** — this endpoint has no server-side filtering or pagination, so the tool fetches **every** scheduled task on the site before applying `filter`/`limit`. On large sites that is a big, slow response, so favour narrow calls:
  - One flow's schedule: `filter: "flow.id:eq:`uuid`"`.
  - Only failing schedules: `filter: "consecutiveFailedCount:gt:0"`.
  - Only active daily schedules: `filter: "schedule.frequency:eq:Daily,schedule.state:eq:Active"`.
  - For a quick existence check ("are any flows scheduled?"), pass a small `limit` (e.g. 10).

  **Filterable Fields:**

  | Field | Type | Operators | Example |
  |-------|------|-----------|---------|
  | `id` | string | `eq`, `in` | `id:eq:1bff10bb-57ae-43df-8774-a86d14aef432` |
  | `type` | string | `eq`, `in` | `type:eq:RunFlowTask` |
  | `priority` | number | `eq`, `gt`, `gte`, `lt`, `lte` | `priority:gte:5` |
  | `consecutiveFailedCount` | number | `eq`, `gt`, `gte`, `lt`, `lte` | `consecutiveFailedCount:gt:0` |
  | `flow.id` | string | `eq`, `in` | `flow.id:eq:8a320dca-9151-41ea-8474-a0bb71961cc0` |
  | `flow.name` | string | `eq`, `in` | `flow.name:eq:Daily Sales` |
  | `schedule.id` | string | `eq`, `in` | `schedule.id:eq:36d6fab2-2a0a-432e-b464-9fe4229a9937` |
  | `schedule.name` | string | `eq`, `in` | `schedule.name:eq:Daily Refresh` |
  | `schedule.state` | string | `eq`, `in` | `schedule.state:eq:Active` |
  | `schedule.frequency` | string | `eq`, `in` | `schedule.frequency:eq:Daily` |
  | `schedule.nextRunAt` | string (ISO 8601) | `eq`, `gt`, `gte`, `lt`, `lte` | `schedule.nextRunAt:lt:2026-05-25T00:00:00Z` |
  | `schedule.createdAt` | string (ISO 8601) | `eq`, `gt`, `gte`, `lt`, `lte` | `schedule.createdAt:gte:2026-01-01T00:00:00Z` |
  | `schedule.updatedAt` | string (ISO 8601) | `eq`, `gt`, `gte`, `lt`, `lte` | `schedule.updatedAt:gte:2026-05-01T00:00:00Z` |

  **Filter Examples:**
  - Single filter: `schedule.frequency:eq:Daily`
  - Multiple filters (AND): `schedule.frequency:eq:Daily,schedule.state:eq:Active`
  - IN operator (bracket/comma list): `schedule.state:in:[Active,Suspended]` (pipe form `Active|Suspended` is also accepted)
  - Failing schedules: `consecutiveFailedCount:gt:0`

  **Response:** Returns `{ flowTasks: [...], mcp: { resultInfo } }`. Each task in `flowTasks` includes:
  - `id` – flow run task ID (use this as the task id to run the flow on demand)
  - `flow.id`, `flow.name` – the target flow
  - `schedule` – frequency, nextRunAt, state, name, and timestamps
  - `priority`, `consecutiveFailedCount`, `type`

  `mcp.resultInfo` is ALWAYS present and reports completeness: `returnedCount`, `totalAvailable` (the full count matching the filter — always known here because every task is fetched), `truncated`, and `truncationReason` (`requested-limit` | `admin-cap`).

  **Reporting to the user (every call):** translate `mcp.resultInfo` into one plain sentence — never say "resultInfo". `truncated:false` → "these are all N scheduled tasks". `requested-limit` → "showing the first N of M — say if you want the rest". `admin-cap` → "showing the first N of M; a site limit caps results per call — I can narrow the filter, or an admin can raise the cap". Also surface the **Caller-role visibility** limit when presenting results: non-admins see scheduled tasks ONLY for flows they **own** (not flows merely shared with them), so a scheduled flow they can see in the Tableau web UI may be missing here. Call this out especially on empty or unexpectedly short results. (Site/server administrators are exempt — they get every scheduled flow task, so do not state this limit to an admin caller.)

  **Note:** Requires Tableau REST API access scope `tableau:flow_tasks:read`. Date-time filter values must be full ISO 8601 (e.g. `2026-05-25T00:00:00Z`). The Tableau REST API does not support server-side filtering or pagination for this endpoint — all tasks are retrieved and filtered/limited client-side by this tool.
  

## APIs called

Talks to Tableau Cloud or Tableau Server.

- 
  Retrieves the scheduled flow run tasks on a Tableau site.

## Optional arguments

### `filter`

The filter argument.

### `pageSize`

The pageSize argument.

### `limit`

The limit argument.

{/* tool-details */}
## Caller-role visibility

- **Non-admin callers** — Tableau returns the scheduled tasks only for flows the caller owns.
- **Server / site-admin callers** — Tableau returns **every** scheduled flow task on the site.

This tool is **not** admin-gated; any authenticated user can call it and will see the tasks Tableau
exposes to them.

## Response-size guidance

The Tableau "Get Flow Run Tasks" endpoint has **no server-side filtering or pagination**, so the
tool fetches **every** scheduled task on the site and then applies `filter`/`limit` in-process. On
large sites that is a big, slow response, so the tool description steers the LLM toward the narrowest
call that answers the question:

| Question shape                      | Recommended arguments                                            |
| ----------------------------------- | ---------------------------------------------------------------- |
| "When does flow X run next?"        | `filter: "flow.id:eq:<uuid>"`                                    |
| "Which schedules are failing?"      | `filter: "consecutiveFailedCount:gt:0"`                          |
| "Which daily schedules are active?" | `filter: "schedule.frequency:eq:Daily,schedule.state:eq:Active"` |
| "Are any flows scheduled at all?"   | a small `limit` (e.g. `10`)                                      |

## Bounded context (fail-closed)

A flow run task carries the flow's id and name but no project or tag, so when the server is
restricted to an [`INCLUDE_PROJECT_IDS`](../../configuration/mcp-config/tool-scoping.md#include_project_ids) or
[`INCLUDE_TAGS`](../../configuration/mcp-config/tool-scoping.md#include_tags) bounded context this tool **cannot** prove
a task's flow belongs to the allowed set. Rather than risk leaking schedules for flows outside the
allow-list, it returns no tasks and explains why.

## Result info

The response is an object `{ flowTasks: [...], mcp: { resultInfo } }`. The `flowTasks` array holds one
record per scheduled task; `mcp.resultInfo` is **always present** and reports whether that array is
complete:

- `returnedCount` — number of tasks in `flowTasks`.
- `totalAvailable` — number of tasks matching the filter before any limit. Always exact here, because
  the endpoint returns every task and filtering/limiting happen in-process.
- `truncated` — `true` when a `limit`/`pageSize` or an admin `MAX_RESULT_LIMIT` cut the list short.
- `truncationReason` — `requested-limit` (caller's `limit`/`pageSize`) or `admin-cap` (site limit), present only when `truncated` is `true`.

## Worked example

```json
{
  "flowTasks": [
    {
      "id": "1bff10bb-57ae-43df-8774-a86d14aef432",
      "priority": 50,
      "consecutiveFailedCount": 2,
      "type": "RunFlowTask",
      "schedule": {
        "id": "36d6fab2-2a0a-432e-b464-9fe4229a9937",
        "name": "Every 2 Minutes",
        "state": "Active",
        "priority": 50,
        "createdAt": "2018-11-08T21:57:49Z",
        "updatedAt": "2018-11-09T17:30:08Z",
        "type": "Flow",
        "frequency": "Hourly",
        "nextRunAt": "2018-11-09T17:32:00Z"
      },
      "flow": {
        "id": "8a320dca-9151-41ea-8474-a0bb71961cc0",
        "name": "allUseCaseTFLX2"
      }
    }
  ],
  "mcp": { "resultInfo": { "returnedCount": 1, "truncated": false, "totalAvailable": 1 } }
}
```
{/* /tool-details */}
