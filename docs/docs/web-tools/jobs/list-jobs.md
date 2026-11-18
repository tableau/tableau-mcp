---
sidebar_position: 1
---

# List Jobs

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Retrieves a list of background jobs for the Tableau site. Each job represents a background task such as an extract refresh, subscription delivery, flow run, or other asynchronous operation. Filtering and pagination are applied server-side by the Tableau REST API.


:::warning[Admin Only]
Registered only when [`ADMIN_TOOLS_ENABLED`](../../configuration/mcp-config/env-vars.md#admin_tools_enabled)`=true`. At request time the caller's site role is verified and anything below `SiteAdministratorCreator` / `SiteAdministratorExplorer` / `ServerAdministrator` is rejected.
:::

## Access requirements

- **User/site roles:** `SupportUser`, `SiteAdministratorExplorer`,
  `SiteAdministratorCreator`, or `ServerAdministrator`. The tool checks administrative access
  at request time, even when registration-time role enforcement is disabled.
- **Declared registration minimum:** `SupportUser`. See [role enforcement](../overview.md#role-enforcement)
  for when this filters the tool list and which roles qualify.
- **Availability:** `ADMIN_TOOLS_ENABLED=true` or the `admin-tools` feature flag.

## APIs called

This tool reads background jobs through the **Tableau REST API** (Tableau Cloud or Server). Every request is admin-gated — the admin-gate read below runs first and rejects non-administrators before the jobs list is returned. The MCP-layer OAuth scope for this tool is `tableau:mcp:jobs:read`; it requires the union of the scopes cited per operation below (`tableau:jobs:read` and `tableau:users:read`).

- **Enforce the admin gate.** Reads the caller's user record to verify the site role and rejects anything below `SiteAdministratorCreator` / `SiteAdministratorExplorer` / `ServerAdministrator` before any jobs are listed.
  - `GET /api/{version}/sites/{siteId}/users/{userId}` — read the caller's site role. Issued against the Tableau REST API; requires the `tableau:users:read` OAuth scope. [Query User on Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#query_user_on_site)
- **List background jobs.** Returns the site's background jobs (extract refreshes, subscriptions, flow runs, and other asynchronous operations), with any `filter`, `pageSize`, and `pageNumber` applied server-side.
  - `GET /api/{version}/sites/{siteId}/jobs` — list background jobs. Issued against the Tableau REST API; requires the `tableau:jobs:read` OAuth scope (Tableau Cloud, API 3.27+). [Query Jobs](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_jobs_tasks_and_schedules.htm#query_jobs)

## Optional arguments

### `filter`

Server-side filter string with the format `field:operator:value`. Multiple filters are comma-separated and combined with AND logic. The string is validated locally and then sent directly to the Tableau REST API, which performs the filtering.

#### Example

`jobType:eq:refresh_extracts`

#### Filterable fields

| Field | Type | Operators | Example |
|-------|------|-----------|---------|
| `jobType` | string | `eq`, `in` | `jobType:eq:refresh_extracts` |
| `status` | string | `eq` | `status:eq:Failed` |
| `progress` | number | `eq`, `gt`, `gte`, `lt`, `lte` | `progress:lte:0` |
| `priority` | number | `eq`, `gt`, `gte`, `lt`, `lte` | `priority:lte:10` |
| `title` | string | `eq`, `has` | `title:has:Superstore` |
| `subtitle` | string | `eq`, `has` | `subtitle:has:weekly` |
| `notes` | string | `has` | `notes:has:nightly` |
| `args` | string | `has` | `args:has:datasource` |
| `createdAt` | string (ISO 8601) | `eq`, `gt`, `gte`, `lt`, `lte` | `createdAt:gt:2026-05-01T11:00:56Z` |
| `startedAt` | string (ISO 8601) | `eq`, `gt`, `gte`, `lt`, `lte` | `startedAt:gte:2026-05-01T00:00:00Z` |
| `completedAt` | string (ISO 8601) | `eq`, `gt`, `gte`, `lt`, `lte` | `completedAt:lt:2026-05-25T00:00:00Z` |

#### Filter examples

- Single filter: `jobType:eq:refresh_extracts`
- Multiple filters (AND): `jobType:eq:refresh_extracts,progress:lte:0`
- In operator (bracketed list): `jobType:in:[refresh_extracts,run_flow]`
- Text search: `title:has:Superstore`
- Date filter: `createdAt:gt:2026-05-01T11:00:56Z`
- Flow jobs: `jobType:eq:run_flow`

#### Common job types

| Value | Description |
|-------|-------------|
| `refresh_extracts` | Full extract refresh |
| `increment_extracts` | Incremental extract refresh |
| `subscription` | Subscription delivery |
| `run_flow` | Flow execution |

<hr />

### `pageSize`

Number of results to return per page. Range: `1`–`1000`. Defaults to `100`.

#### Example

`50`

<hr />

### `pageNumber`

Page number to return (1-based). Defaults to `1`.

#### Example

`2`

## Example results

Each job includes:

- `id` – job ID
- `status` – current status (Success, Failed, InProgress, Pending, Cancelled)
- `jobType` – type of job (refresh_extracts, increment_extracts, subscription, run_flow)
- `priority` – job priority
- `createdAt` – when the job was created (ISO 8601)
- `startedAt` – when the job started executing (ISO 8601)
- `endedAt` – when the job finished (ISO 8601)
- `progress` – completion percentage
- `title` – human-readable description

### Jobs found

```json
[
  {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "Success",
    "jobType": "refresh_extracts",
    "priority": 50,
    "createdAt": "2026-05-20T10:00:00Z",
    "startedAt": "2026-05-20T10:00:05Z",
    "endedAt": "2026-05-20T10:05:00Z",
    "progress": 100,
    "title": "Refreshing Sales Data"
  },
  {
    "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    "status": "Failed",
    "jobType": "refresh_extracts",
    "priority": 50,
    "createdAt": "2026-05-21T08:00:00Z",
    "startedAt": "2026-05-21T08:00:02Z",
    "endedAt": "2026-05-21T08:01:30Z",
    "progress": 45,
    "title": "Refreshing Marketing Analytics"
  }
]
```

### No jobs found

When no jobs match the criteria (or the caller cannot view any), the tool returns a message instead of a list:

```
No jobs were found. Either none exist matching the criteria or you do not have permission to view them.
```

## Related

- [`list-extract-refresh-tasks`](../tasks/list-extract-refresh-tasks.md) — the scheduled extract-refresh tasks whose runs surface here as jobs
- [`query-admin-insights`](../admin-insights/query-admin-insights.md) — the `job-performance` backend for historical extract-refresh and subscription execution

{/* tool-details */}
## Use cases

Use this tool when you need to:
- Monitor the status of background jobs (extract refreshes, subscriptions, flows)
- Find failed or in-progress jobs
- Investigate job history and performance
- Check job completion times and progress
- Troubleshoot extract refresh or subscription failures

## Configuration

Enable this tool by setting:

See also: [Environment Variables](../../configuration/mcp-config/env-vars.md)

## Empty result

If no jobs are found, the tool returns a message:
{/* /tool-details */}
