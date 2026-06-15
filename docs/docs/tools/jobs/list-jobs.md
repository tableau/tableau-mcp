---
sidebar_position: 1
---

# List Jobs

Retrieves a list of background jobs for the Tableau site. Each job represents a background task such as an extract refresh, subscription delivery, flow run, or other asynchronous operations.

:::warning Admin Only
This tool is restricted to Tableau site administrators and requires the `ADMIN_TOOLS_ENABLED` feature flag to be enabled.
:::

## APIs called

- [Query Jobs](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_jobs_tasks_and_schedules.htm#query_jobs)

## Use cases

Use this tool when you need to:
- Monitor the status of background jobs (extract refreshes, subscriptions, flows)
- Find failed or in-progress jobs
- Investigate job history and performance
- Check job completion times and progress
- Troubleshoot extract refresh or subscription failures

## Required permissions

- **Tableau Cloud**: Requires `tableau:jobs:read` OAuth scope (API 3.27+)
- **Site Role**: Must be one of:
  - SiteAdministratorCreator
  - SiteAdministratorExplorer
  - ServerAdministrator

## Configuration

Enable this tool by setting the feature flag:

```bash
ADMIN_TOOLS_ENABLED=true
```

See also: [Environment Variables](../../configuration/mcp-config/env-vars.md)

## Arguments

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filter` | string | No | Server-side filter string with format `field:operator:value`. Multiple filters are comma-separated (AND logic). |
| `pageSize` | number | No | Number of results per page (max 1000, default 100) |
| `pageNumber` | number | No | Page number (default 1) |

### Filterable fields

Filtering is handled server-side by the Tableau REST API.

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

### Filter examples

- Single filter: `jobType:eq:refresh_extracts`
- Multiple filters (AND): `jobType:eq:refresh_extracts,progress:lte:0`
- In operator (bracketed list): `jobType:in:[refresh_extracts,run_flow]`
- Text search: `title:has:Superstore`
- Date filter: `createdAt:gt:2026-05-01T11:00:56Z`
- Flow jobs: `jobType:eq:run_flow`

### Common job types

| Value | Description |
|-------|-------------|
| `refresh_extracts` | Full extract refresh |
| `increment_extracts` | Incremental extract refresh |
| `subscription` | Subscription delivery |
| `run_flow` | Flow execution |

## Response structure

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

## Example result

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

## Empty result

If no jobs are found, the tool returns a message:

```
No jobs were found. Either none exist matching the criteria or you do not have permission to view them.
```
