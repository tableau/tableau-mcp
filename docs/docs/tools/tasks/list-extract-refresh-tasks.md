---
sidebar_position: 1
---

# List Extract Refresh Tasks

Retrieves a list of extract refresh tasks for the Tableau site. Each task describes a scheduled refresh for a data source or workbook extract and includes schedule information (e.g. frequency, next run time, schedule name on Server).

:::warning Admin Only
This tool is restricted to Tableau site administrators and requires the `ADMIN_TOOLS_ENABLED` site setting to be enabled.
:::

## APIs called

- [Get Extract Refresh Tasks](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_extract_and_encryption.htm#list_extract_refresh_tasks_in_site)

## Use cases

Use this tool when you need to:
- See which data sources or workbooks have extract refresh schedules
- Find the refresh schedule (frequency, next run time) for specific datasources or workbooks
- List all extract refresh tasks on the site
- Analyze extract refresh patterns for schedule optimization

## Required permissions

- **Tableau Cloud**: Requires `tableau:tasks:read` OAuth scope
- **Tableau Server**: Users see only tasks they own unless they are site or server administrators
- **Site Role**: Must be one of:
  - SiteAdministratorCreator
  - SiteAdministratorExplorer  
  - ServerAdministrator

## Configuration

Enable this tool by setting:

```bash
ADMIN_TOOLS_ENABLED=true
```

See also: [Environment Variables](../../configuration/mcp-config/env-vars.md)

## Arguments

This tool takes no arguments.

:::note API Limitation
The Tableau REST API does not support filtering or pagination parameters for extract refresh tasks. All tasks are returned in a single request. For sites with many extract refresh tasks, consider using client-side filtering based on the returned data.
:::

## Response structure

Each task includes:

- `id` – extract refresh task ID
- `datasource.id` or `workbook.id` – the target data source or workbook
- `schedule` – frequency, nextRunAt, and (on Tableau Server) name, state, id
  - `frequency` – Daily, Weekly, Monthly, or Hourly
  - `nextRunAt` – ISO 8601 timestamp of next scheduled run
  - `frequencyDetails.intervals` – detailed interval configuration (hours, minutes, weekDay, monthDay)

## Example result

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

## Empty result

If no extract refresh tasks are found, the tool returns a message:

```
No extract refresh tasks were found. Either none exist or you do not have permission to view them.
```
