---
sidebar_position: 2
---

# List Schedules

Retrieves the list of refresh schedules in use on the Tableau site. Each schedule includes its frequency and next run time, plus aggregation metadata describing how many extract refresh tasks run on it (`taskCount`) and which data sources and workbooks those tasks target.

:::warning Admin Only
This tool is restricted to Tableau site administrators and requires the `ADMIN_TOOLS_ENABLED` feature flag to be enabled.
:::

:::info Tableau Cloud schedule model
Tableau Cloud does not expose a standalone schedules collection — the `GET /sites/{siteId}/schedules` and server-level `GET /schedules` endpoints are **Tableau Server only**. On Cloud, schedule information is only available embedded in each task. This tool derives the schedule universe by aggregating the distinct schedules referenced by the site's extract refresh tasks.
:::

## APIs called

- [Get Extract Refresh Tasks in Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_extract_and_encryption.htm#list_extract_refresh_tasks_in_site)

## Use cases

Use this tool when you need to:
- Enumerate the distinct refresh schedules configured on the site
- See how many tasks (and which content) share a given schedule
- Identify under- or over-used schedules for consolidation
- Analyze schedule usage for extract refresh schedule optimization

## Required permissions

- **Tableau Cloud**: Requires `tableau:tasks:read` OAuth scope
- **Tableau Server**: Site or server administrators
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

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `filter` | string | No | Client-side filter string with format `field:operator:value`. Multiple filters are comma-separated (AND logic). |
| `pageSize` | number | No | Reserved for future server-side pagination; currently informational. |
| `limit` | number | No | Maximum total schedules to return (client-side limit after filtering). |

:::note API Limitation
The Tableau REST API does not expose schedules as a standalone collection on Tableau Cloud. Schedules are aggregated from the site's extract refresh tasks, and filtering and limiting are performed client-side by this tool.
:::

## Filterable Fields

| Field | Type | Operators | Example |
|-------|------|-----------|---------|
| `id` | string | `eq`, `in` | `id:eq:sched-123` |
| `name` | string | `eq`, `in` | `name:eq:Daily Refresh` |
| `type` | string | `eq`, `in` | `type:eq:Extract` |
| `state` | string | `eq`, `in` | `state:eq:Active` |
| `frequency` | string | `eq`, `in` | `frequency:eq:Daily` |
| `priority` | number | `eq`, `gt`, `gte`, `lt`, `lte` | `priority:gte:5` |
| `taskCount` | number | `eq`, `gt`, `gte`, `lt`, `lte` | `taskCount:gt:1` |
| `nextRunAt` | string (ISO 8601) | `eq`, `gt`, `gte`, `lt`, `lte` | `nextRunAt:lt:2026-05-25T00:00:00Z` |
| `createdAt` | string (ISO 8601) | `eq`, `gt`, `gte`, `lt`, `lte` | `createdAt:gte:2026-01-01T00:00:00Z` |
| `updatedAt` | string (ISO 8601) | `eq`, `gt`, `gte`, `lt`, `lte` | `updatedAt:gte:2026-05-01T00:00:00Z` |

### Frequencies

Common values for `frequency`:
- `Hourly`
- `Daily`
- `Weekly`
- `Monthly`

### States

Common values for `state`:
- `Active` - Schedule is enabled and running
- `Suspended` - Schedule is paused

### Filter Examples

- Find all daily schedules: `frequency:eq:Daily`
- Multiple frequencies: `frequency:in:Daily|Weekly`
- Shared schedules (more than one task): `taskCount:gt:1`
- Single-task schedules (consolidation candidates): `taskCount:eq:1`
- High-priority daily schedules: `frequency:eq:Daily,priority:gte:5`
- Schedules running before a cutoff: `nextRunAt:lt:2026-06-01T00:00:00Z`

## Response structure

Each schedule includes:

- `id` – schedule ID (when available)
- `name` – schedule name (when available)
- `type` – schedule type (e.g., `Extract`)
- `state` – `Active` or `Suspended`
- `frequency` – `Hourly`, `Daily`, `Weekly`, or `Monthly`
- `priority` – schedule priority
- `nextRunAt` – timestamp of the next scheduled run (ISO 8601 format)
- `createdAt` – timestamp the schedule was created (ISO 8601 format)
- `updatedAt` – timestamp the schedule was last updated (ISO 8601 format)
- `frequencyDetails` – detailed interval configuration (hours, minutes, weekDay, monthDay)
- `taskCount` – number of extract refresh tasks that run on this schedule
- `datasourceIds` – distinct data source IDs whose tasks use this schedule
- `workbookIds` – distinct workbook IDs whose tasks use this schedule

## Example result

```json
[
  {
    "id": "schedule-123",
    "name": "Daily Early Morning",
    "type": "Extract",
    "state": "Active",
    "frequency": "Daily",
    "priority": 50,
    "nextRunAt": "2026-05-21T06:00:00Z",
    "frequencyDetails": {
      "intervals": {
        "interval": [{ "hours": 6, "minutes": 0 }]
      }
    },
    "taskCount": 3,
    "datasourceIds": ["2d935df8-fe7e-4fd8-bb14-35eb4ba31d45"],
    "workbookIds": ["3e046e08-f8a3-4f09-c26f-46fa5b8bef13"]
  },
  {
    "id": "schedule-456",
    "name": "Weekly Sunday",
    "type": "Extract",
    "state": "Active",
    "frequency": "Weekly",
    "priority": 70,
    "nextRunAt": "2026-05-25T08:00:00Z",
    "frequencyDetails": {
      "intervals": {
        "interval": [{ "weekDay": "Sunday", "hours": 8, "minutes": 0 }]
      }
    },
    "taskCount": 1,
    "datasourceIds": ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"]
  }
]
```

## Empty result

If no schedules are found, the tool returns a message:

```
No schedules were found. Either none exist or you do not have permission to view them.
```

## Use Case: Extract Refresh Schedule Optimization

This tool supports extract refresh schedule optimization (JTBD #2 from the Admin Tools roadmap) by exposing the schedule universe so it can be paired with [List Extract Refresh Tasks](./list-extract-refresh-tasks.md) and job performance data:

```javascript
// Find consolidation candidates: schedules used by only one task
filter: "taskCount:eq:1"

// Find heavily shared daily schedules
filter: "frequency:eq:Daily,taskCount:gt:5"

// Find high-priority schedules that may be over-provisioned
filter: "priority:gte:70"
```

The results can inform decisions about:
- Consolidating single-task schedules onto shared schedules
- Downgrading or disabling under-used schedules
- Moving refresh windows to balance load
