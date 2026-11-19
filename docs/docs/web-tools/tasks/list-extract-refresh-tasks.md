---
sidebar_position: 1
---

# List Extract Refresh Tasks

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Retrieves a list of extract refresh tasks for the Tableau site. Each task describes a scheduled refresh for a **data source** or **workbook** extract and includes schedule information (e.g. frequency, next run time, schedule name on Server).

Use it to:

- See which data sources or workbooks have extract refresh schedules
- Find the refresh schedule (frequency, next run) for specific datasources or workbooks
- List all extract refresh tasks on the site
- Analyze extract refresh patterns for schedule optimization


:::warning[Admin Only]
Registered only when [`ADMIN_TOOLS_ENABLED`](../../configuration/mcp-config/env-vars.md#admin_tools_enabled)`=true`. The tool is restricted to Tableau site administrators, and the caller's site role is verified at request time.
:::

## APIs called

This tool talks to the **Tableau REST API** (Tableau Cloud or Server). At the MCP layer it is gated on the `tableau:mcp:tasks:read` scope; the underlying REST calls require the `tableau:tasks:read` and `tableau:users:read` OAuth scopes.

- List the site's extract refresh tasks. The Tableau REST API returns all tasks in a single response; the MCP server applies any client-side filtering and limiting afterward.
  - `GET /api/{version}/sites/{siteId}/tasks/extractRefreshes` — retrieve every extract refresh task on the site. Issued against the REST API; requires the `tableau:tasks:read` OAuth scope. [Get Extract Refresh Tasks](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_extract_and_encryption.htm#list_extract_refresh_tasks_in_site)
- Verify the caller is a site administrator before returning any data. The caller's site role must be `SiteAdministratorCreator`, `SiteAdministratorExplorer`, or `ServerAdministrator`, otherwise the tool returns a permission error.
  - `GET /api/{version}/sites/{siteId}/users/{userId}` — look up the caller's site role for the admin check. Issued against the REST API; requires the `tableau:users:read` OAuth scope. [Query User On Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#query_user_on_site)

## Optional arguments

### `filter`

A client-side filter string in `field:operator:value` form. Multiple filters are comma-separated and combined with AND logic. The Tableau REST API does not support server-side filtering for extract refresh tasks, so all tasks are fetched and filtered client-side by the MCP server.

Filterable fields:

| Field | Type | Operators | Example |
|-------|------|-----------|---------|
| `id` | string | `eq`, `in` | `id:eq:abc123` |
| `type` | string | `eq`, `in` | `type:eq:RefreshExtractTask` |
| `priority` | number | `eq`, `gt`, `gte`, `lt`, `lte` | `priority:gte:5` |
| `consecutiveFailedCount` | number | `eq`, `gt`, `gte`, `lt`, `lte` | `consecutiveFailedCount:gt:0` |
| `datasource.id` | string | `eq`, `in` | `datasource.id:eq:ds-123` |
| `workbook.id` | string | `eq`, `in` | `workbook.id:eq:wb-456` |
| `schedule.id` | string | `eq`, `in` | `schedule.id:eq:sched-789` |
| `schedule.name` | string | `eq`, `in` | `schedule.name:eq:Daily Refresh` |
| `schedule.state` | string | `eq`, `in` | `schedule.state:eq:Active` |
| `schedule.frequency` | string | `eq`, `in` | `schedule.frequency:eq:Daily` |
| `schedule.nextRunAt` | string (ISO 8601) | `eq`, `gt`, `gte`, `lt`, `lte` | `schedule.nextRunAt:lt:2026-05-25T00:00:00Z` |
| `schedule.createdAt` | string (ISO 8601) | `eq`, `gt`, `gte`, `lt`, `lte` | `schedule.createdAt:gte:2026-01-01T00:00:00Z` |
| `schedule.updatedAt` | string (ISO 8601) | `eq`, `gt`, `gte`, `lt`, `lte` | `schedule.updatedAt:gte:2026-05-01T00:00:00Z` |

#### Example

```json
{ "filter": "schedule.frequency:eq:Daily,priority:gte:5" }
```

More forms:

- Single filter: `schedule.frequency:eq:Daily`
- Multiple filters (AND): `schedule.frequency:eq:Daily,priority:gte:5`
- `in` operator: `schedule.frequency:in:Daily|Weekly`

:::note[API Limitation]
The Tableau REST API does not support server-side filtering or pagination for extract refresh tasks. All tasks are retrieved in a single request, then filtering and limiting are applied client-side by this tool. For sites with many tasks, prefer narrowing results with `filter`.
:::

<hr />

### `pageSize`

Maximum number of results per page, applied client-side after filtering. Must be a positive integer.

#### Example

```json
{ "pageSize": 50 }
```

<hr />

### `limit`

Maximum total number of results to return, applied client-side after filtering. Must be a positive integer.

#### Example

```json
{ "limit": 100 }
```

:::note
When both `pageSize` and `limit` are provided, the smaller of the two is used as the effective cap on the number of tasks returned.
:::

## Notes and caveats

- On Tableau Server, users see only the extract refresh tasks they own unless they are site or server administrators. Because this tool requires a site-administrator role, an authorized caller sees all tasks on the site.
- Results may be further restricted by the server's bounded-context configuration. When the deployment limits the allowed data source or workbook sets, tasks outside those sets are removed; if every task is filtered out this way, the tool returns an explanatory message instead of an empty list.

## Example results

Each task includes:

- `id` – extract refresh task ID
- `datasource.id` or `workbook.id` – the target data source or workbook
- `schedule` – frequency, nextRunAt, and (on Tableau Server) name, state, id
  - `frequency` – Daily, Weekly, Monthly, or Hourly
  - `nextRunAt` – ISO 8601 timestamp of next scheduled run
  - `frequencyDetails.intervals` – detailed interval configuration (hours, minutes, weekDay, monthDay)

### Extract refresh tasks

```json
[
  {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "datasource": {
      "id": "2d935df8-fe7e-4fd8-bb14-35eb4ba31d45"
    },
    "schedule": {
      "id": "schedule-123",
      "name": "Daily Early Morning",
      "state": "Active",
      "frequency": "Daily",
      "nextRunAt": "2026-05-21T06:00:00Z",
      "frequencyDetails": {
        "intervals": {
          "interval": [
            {
              "hours": 6,
              "minutes": 0
            }
          ]
        }
      }
    }
  },
  {
    "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "workbook": {
      "id": "3e046e08-f8a3-4f09-c26f-46fa5b8bef13"
    },
    "schedule": {
      "id": "schedule-456",
      "name": "Weekly Sunday",
      "state": "Active",
      "frequency": "Weekly",
      "nextRunAt": "2026-05-25T08:00:00Z",
      "frequencyDetails": {
        "intervals": {
          "interval": [
            {
              "weekDay": "Sunday",
              "hours": 8,
              "minutes": 0
            }
          ]
        }
      }
    }
  }
]
```

### No tasks found

If no extract refresh tasks are found, the tool returns a message:

```
No extract refresh tasks were found. Either none exist or you do not have permission to view them.
```

## Related

- [`update-cloud-extract-refresh-task`](./update-cloud-extract-refresh-task.md) — update the schedule of a Tableau Cloud extract refresh task
- [`delete-content`](../content/delete-content.md) — delete content, including extract refresh tasks

{/* tool-details */}
## Use cases

Use this tool when you need to:
- Find the refresh schedule (frequency, next run time) for specific datasources or workbooks

## Configuration

Enable this tool by setting:

See also: [Environment Variables](../../configuration/mcp-config/env-vars.md)
{/* /tool-details */}
