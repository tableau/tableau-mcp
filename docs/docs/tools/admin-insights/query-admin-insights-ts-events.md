---
sidebar_position: 1
---

# Query Admin Insights — TS Events

Issues a [VizQL Data Service (VDS)](https://help.tableau.com/current/api/vizql-data-service/en-us/index.html)
query against the Admin Insights `TS Events` published datasource on the connected Tableau Cloud
site. Returns audit events (Access, Publish, Update, Delete, etc.) for content and users on the
site.

The tool is admin-only — it is registered only when `ADMIN_TOOLS_ENABLED=true`, and at request
time it verifies the caller's site role and rejects anything below
`SiteAdministratorCreator` / `SiteAdministratorExplorer` / `ServerAdministrator`. The Admin
Insights datasource LUID is resolved automatically; callers do not pass `datasourceLuid`.

## APIs called

- [Query Datasource (VDS)](https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/QueryDatasource)
- [Query Data Sources (REST)](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_sources) — used internally to resolve the `TS Events` dataset LUID
- [Get User on Site (REST)](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#get_user_on_site) — used internally for the admin gate

## Required arguments

### `query`

A fully formed VDS [`query`](https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/QueryDatasource)
object: `fields`, `filters`, `parameters`. The schema mirrors the schema accepted by the
[`query-datasource`](../data-qna/query-datasource.md) tool.

Common usage:

- Identify last-access timestamp per content item: filter `Event Type` to `"Access"`, group by
  `Item Id` and `Item Type`, aggregate `MAX(Event Date)`.
- Audit which users last accessed a workbook within the 90-day window.

Example:

```json
{
  "query": {
    "fields": [
      { "fieldCaption": "Item Id" },
      { "fieldCaption": "Item Type" },
      { "fieldCaption": "Event Date", "function": "MAX", "fieldAlias": "last_access" }
    ],
    "filters": [
      {
        "field": { "fieldCaption": "Event Type" },
        "filterType": "SET",
        "values": ["Access"],
        "exclude": false
      },
      {
        "field": { "fieldCaption": "Item Type" },
        "filterType": "SET",
        "values": ["Workbook", "Datasource"],
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

Example: `1000`

See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit)

## Notes and caveats

- Tableau Cloud TS Events lookback caps at **90 days by default** (365 days with Advanced
  Management). Beyond the lookback window, items cannot be distinguished from each other on
  last-access timestamps.
- Field captions on TS Events differ from those on Site Content on the same site. For TS Events,
  the item-identifier caption is `Item Id` (Title Case), not `Item ID`. Inspect the dataset
  schema with [`get-datasource-metadata`](../data-qna/get-datasource-metadata.md) when in doubt.
- This tool intentionally bypasses the standard datasource access checker because the Admin
  Insights datasources are internal/known and admin-gated independently.

## Example result

```json
{
  "data": [
    { "Item Id": "5092107", "Item Type": "Datasource", "last_access": "2026-04-15T00:00:00Z" },
    { "Item Id": "1412202", "Item Type": "Workbook", "last_access": "2026-05-08T21:12:45Z" }
  ]
}
```
