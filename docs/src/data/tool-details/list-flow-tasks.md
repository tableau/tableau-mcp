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
