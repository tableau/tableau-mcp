---
sidebar_position: 2
---

# Query Admin Insights — Site Content

Issues a [VizQL Data Service (VDS)](https://help.tableau.com/current/api/vizql-data-service/en-us/index.html)
query against the Admin Insights `Site Content` published datasource on the connected Tableau
Cloud site. Returns the universe of content items (workbooks, datasources, views, flows,
projects) — including items that have **never been accessed**.

The tool is admin-only — it is registered only when `TMCP_ADMIN_TOOLS_ENABLED=true`, and at request
time it verifies the caller's site role and rejects anything below
`SiteAdministratorCreator` / `SiteAdministratorExplorer` / `ServerAdministrator`. The Admin
Insights datasource LUID is resolved automatically; callers do not pass `datasourceLuid`.

## APIs called

- [Query Datasource (VDS)](https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/QueryDatasource)
- [Query Data Sources (REST)](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_sources) — used internally to resolve the `Site Content` dataset LUID
- [Get User on Site (REST)](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#get_user_on_site) — used internally for the admin gate

## Required arguments

### `query`

A fully formed VDS [`query`](https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/QueryDatasource)
object: `fields`, `filters`, `parameters`. The schema mirrors the schema accepted by the
[`query-datasource`](../data-qna/query-datasource.md) tool.

Common usage:

- Build a stale-content report: list all Workbooks and Datasources with `Item ID`, `Item Name`,
  `Item Parent Project Name`, `Owner Email`, `Created At`, `Updated At`, `Last Accessed At`,
  `Size (bytes)`. The deterministic
  [`get-stale-content-report`](./get-stale-content-report.md) tool wraps exactly this query and
  applies the staleness threshold server-side.
- Inventory content per project or per owner.
- Identify never-accessed items by selecting `Last Accessed At` and filtering for `null`.

Example:

```json
{
  "query": {
    "fields": [
      { "fieldCaption": "Item ID" },
      { "fieldCaption": "Item Type" },
      { "fieldCaption": "Item Name" },
      { "fieldCaption": "Item Parent Project Name" },
      { "fieldCaption": "Owner Email" },
      { "fieldCaption": "Created At" },
      { "fieldCaption": "Updated At" },
      { "fieldCaption": "Last Accessed At" },
      { "fieldCaption": "Size (bytes)" }
    ],
    "filters": [
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

- `Site Content` exposes a native `Last Accessed At` field per item — the value is `null` for
  items that have never been accessed. This is a key advantage over a TS Events anti-join, which
  is bounded by the 90-day event lookback window.
- Field captions on `Site Content` differ from those on `TS Events` on the same site (e.g.
  `Item ID` here vs `Item Id` on TS Events; `Item Parent Project Name` here vs `Project Name`
  on TS Events). Inspect the dataset schema with
  [`get-datasource-metadata`](../data-qna/get-datasource-metadata.md) when in doubt.
- The `Item ID` field is returned as an integer by VDS, not a string.
- This tool intentionally bypasses the standard datasource access checker because the Admin
  Insights datasources are internal/known and admin-gated independently.

## Example result

```json
{
  "data": [
    {
      "Item ID": 1412202,
      "Item Type": "Workbook",
      "Item Name": "World Indicators",
      "Item Parent Project Name": "Samples",
      "Owner Email": "owner@example.com",
      "Created At": "2025-09-02T23:26:02",
      "Updated At": "2025-09-02T23:26:02",
      "Last Accessed At": null,
      "Size (bytes)": 796179
    }
  ]
}
```
