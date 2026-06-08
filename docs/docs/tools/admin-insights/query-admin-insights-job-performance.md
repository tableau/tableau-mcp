---
sidebar_position: 3
---

# Query Admin Insights — Job Performance

Issues a [VizQL Data Service (VDS)](https://help.tableau.com/current/api/vizql-data-service/en-us/index.html)
query against the Admin Insights `Job Performance` published datasource on the connected Tableau Cloud
site. Returns records of extract refresh jobs, subscription jobs, flow runs, and bridge jobs.

The tool is admin-only — it is registered only when `ADMIN_TOOLS_ENABLED=true`, and at request
time it verifies the caller's site role and rejects anything below
`SiteAdministratorCreator` / `SiteAdministratorExplorer` / `ServerAdministrator`. The Admin
Insights datasource LUID is resolved automatically; callers do not pass `datasourceLuid`.

## APIs called

- [Query Datasource (VDS)](https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/QueryDatasource)
- [Query Data Sources (REST)](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_sources) — used internally to resolve the `Job Performance` dataset LUID
- [Get User on Site (REST)](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#get_user_on_site) — used internally for the admin gate

## Required arguments

### `query`

A fully formed VDS [`query`](https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/QueryDatasource)
object: `fields`, `filters`, `parameters`. The schema mirrors the schema accepted by the
[`query-datasource`](../data-qna/query-datasource.md) tool.

The `fields` array must contain at least one entry — omitting it causes a VDS error.

Common usage:

- Analyze extract refresh durations and failure rates per datasource or workbook.
- Identify extracts with high consecutive failure counts or long run times.
- Compare scheduled frequency against actual job completion times to recommend schedule optimization.
- Find jobs that overlap or compete for resources in the same time window.

### Available fields

| Category | Fields |
|----------|--------|
| **Job identity** | Job ID, Job LUID, Job Type, Job Result, Final Job Result |
| **Item details** | Item ID, Item LUID, Item Name, Item Type, Item Hyperlink |
| **Timing (UTC)** | Created At, Queued At, Started At, Completed At, Overflow Queued At |
| **Timing (local)** | Created At (local), Queued At (local), Started At (local), Completed At (local), Overflow Queued At (local) |
| **Durations (seconds)** | Job Duration, Job Execution Duration, Job Queued Duration, Job Overflow Queued Duration |
| **Schedule** | Schedule Name, Schedule LUID |
| **Owner/Project** | Owner Email, Parent Project Name, Parent Project Owner Email |
| **Extract** | Extract File Size |
| **Subscription** | Subscriber Email, Subscriber ID, Subscription Subject |
| **Bridge** | Agent Name, Agent Version, Agent Timezone, Agent is Pooled?, Pool Name, Bridge Started At, Bridge Completed At, Bridge Started At (Local), Bridge Completed At (Local), Bridge Refresh Duration, Bridge Extract Upload Duration, Bridge Job Result, Bridge Error Message, Bridge Error Type, Bridge Initiator User Name |
| **Flags** | Was Manual Run, Was Overflow Queued |
| **Other** | Error Message, Admin Insights Published At |

Example:

```json
{
  "query": {
    "fields": [
      { "fieldCaption": "Item Name" },
      { "fieldCaption": "Job Type" },
      { "fieldCaption": "Job Result" },
      { "fieldCaption": "Started At" },
      { "fieldCaption": "Job Duration" },
      { "fieldCaption": "Schedule Name" }
    ],
    "filters": [
      {
        "field": { "fieldCaption": "Job Type" },
        "filterType": "SET",
        "values": ["Refresh Extracts"],
        "exclude": false
      }
    ]
  }
}
```

## Optional arguments

### `limit`

The maximum number of rows to return. The tool will pass this through as `rowLimit` on the VDS
request and additionally truncate the response if VDS returns more rows than requested.

Example: `500`

See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit)

## Parameters

The Job Performance datasource exposes a `Timezone` parameter (integer offset, e.g. `-7` for PDT).
Local-time fields (`Started At (local)`, `Completed At (local)`, etc.) are adjusted by this
parameter. Pass it via the `parameters` field of the query object if you need local-time output.

## Notes and caveats

- Tableau Cloud Job Performance lookback caps at **90 days by default** (365 days with Advanced
  Management).
- The datasource does not support server-side pagination — use filters and `limit` to control
  response size. For large sites, always filter by `Job Type` and/or a date range on `Started At`.
- This tool intentionally bypasses the standard datasource access checker because the Admin
  Insights datasources are internal/known and admin-gated independently.
- For the complete field schema with data types and descriptions, use
  [`get-datasource-metadata`](../data-qna/get-datasource-metadata.md) with the Job Performance
  datasource LUID.

## Example result

```json
{
  "data": [
    {
      "Item Name": "Sales Pipeline",
      "Job Type": "Refresh Extracts",
      "Job Result": "Succeeded",
      "Started At": "2026-05-28T08:00:12Z",
      "Job Duration": 45.2,
      "Schedule Name": "Daily at 8am"
    },
    {
      "Item Name": "Marketing Dashboard",
      "Job Type": "Refresh Extracts",
      "Job Result": "Failed",
      "Started At": "2026-05-28T08:15:00Z",
      "Job Duration": 120.8,
      "Schedule Name": "Daily at 8am"
    }
  ]
}
```

## Related

- The MCP prompt `job-optimization-inform` invokes this tool and renders the results as a job
  optimization report for human-in-the-loop review. It defaults to extract refresh jobs and can
  discover and analyze every job type on the site.
