---
sidebar_position: 4
---

# List Flow Tasks

Retrieves the scheduled flow run tasks on a site. A flow run task is the **schedule** for a Tableau
Prep flow — when and how often it is configured to run — **not** a record of past executions. For
run history, use [List Flow Runs](list-flow-runs.md).

Each task includes the target flow (`flow.id`, `flow.name`), the schedule (frequency, next run time,
state), and the task `id` used to trigger an on-demand run.

## APIs called

- [Get Flow Run Tasks](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#get_flow_run_tasks)

## Required Tableau API scopes

When the MCP server authenticates with OAuth (connected-app JWT), this tool requests:

- `tableau:flow_tasks:read`
- `tableau:mcp_site_settings:read`

The `tableau:flow_tasks:read` scope was added in Tableau Cloud December 2025 / Server 2025.3. See
[OAuth configuration](../../configuration/mcp-config/oauth.md) for how scopes are negotiated.

## Caller-role visibility

- **Non-admin callers** — Tableau returns the scheduled tasks only for flows the caller owns.
- **Server / site-admin callers** — Tableau returns **every** scheduled flow task on the site.

This tool is **not** admin-gated; any authenticated user can call it and will see the tasks Tableau
exposes to them.

## Optional arguments

### `filter`

A client-side filter string in the format `field:operator:value`. Multiple expressions are combined
with a comma using a logical AND. The Tableau REST API does not support server-side filtering for
this endpoint, so all tasks are fetched and filtered in-process.

| Field                    | Type              | Operators              | Example                                       |
| ------------------------ | ----------------- | ---------------------- | --------------------------------------------- |
| `id`                     | string            | `eq, in`               | `id:eq:1bff10bb-57ae-43df-8774-a86d14aef432`  |
| `type`                   | string            | `eq, in`               | `type:eq:RunFlowTask`                         |
| `priority`               | number            | `eq, gt, gte, lt, lte` | `priority:gte:5`                              |
| `consecutiveFailedCount` | number            | `eq, gt, gte, lt, lte` | `consecutiveFailedCount:gt:0`                 |
| `flow.id`                | string            | `eq, in`               | `flow.id:eq:8a320dca-9151-41ea-8474-...`      |
| `flow.name`              | string            | `eq, in`               | `flow.name:eq:Daily Sales`                    |
| `schedule.id`            | string            | `eq, in`               | `schedule.id:eq:36d6fab2-2a0a-...`            |
| `schedule.name`          | string            | `eq, in`               | `schedule.name:eq:Daily Refresh`              |
| `schedule.state`         | string            | `eq, in`               | `schedule.state:eq:Active`                    |
| `schedule.frequency`     | string            | `eq, in`               | `schedule.frequency:eq:Daily`                 |
| `schedule.nextRunAt`     | string (ISO 8601) | `eq, gt, gte, lt, lte` | `schedule.nextRunAt:lt:2026-05-25T00:00:00Z`  |
| `schedule.createdAt`     | string (ISO 8601) | `eq, gt, gte, lt, lte` | `schedule.createdAt:gte:2026-01-01T00:00:00Z` |
| `schedule.updatedAt`     | string (ISO 8601) | `eq, gt, gte, lt, lte` | `schedule.updatedAt:gte:2026-05-01T00:00:00Z` |

The `in` operator accepts a bracket/comma list (e.g. `schedule.state:in:[Active,Suspended]`),
matching every other `list-*` tool; the legacy pipe-delimited form
(`schedule.state:in:Active|Suspended`) is also accepted. Date-time values must be full ISO 8601
(e.g. `2026-05-25T00:00:00Z`).

Examples:

- `schedule.frequency:eq:Daily,schedule.state:eq:Active`
- `consecutiveFailedCount:gt:0` (schedules that are failing repeatedly)

<hr />

### `pageSize`

The maximum number of results per page, applied client-side after filtering.

### `limit`

The maximum total number of tasks to return, applied client-side after filtering.

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

## Example result

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
