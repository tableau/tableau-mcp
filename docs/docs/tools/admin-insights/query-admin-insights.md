---
sidebar_position: 5
---

# Query Admin Insights

Queries all three Tableau Cloud Admin Insights datasources and the deterministic stale-content
report through a single entry point. Dispatches on `kind` to one of four backends:

- `ts-events` — raw VDS query against the `TS Events` datasource (audit events: access, publish,
  update, delete)
- `site-content` — raw VDS query against the `Site Content` datasource (content metadata,
  ownership, sizes)
- `job-performance` — raw VDS query against the `Job Performance` datasource (extract refresh and
  subscription execution history)
- `stale-content` — server-side anti-join that returns already-filtered stale rows with no
  client-side math required

The tool is admin-only — it is registered only when `ADMIN_TOOLS_ENABLED=true`, and at request
time it verifies the caller's site role and rejects anything below
`SiteAdministratorCreator` / `SiteAdministratorExplorer` / `ServerAdministrator`. Admin Insights
datasource LUIDs are resolved automatically; callers do not pass `datasourceLuid`.


## APIs called

- [Query Datasource (VDS)](https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/QueryDatasource)
  — issues the VDS query for `ts-events`, `site-content`, `job-performance`, and the `stale-content` backend
- [Query Data Sources (REST)](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_sources)
  — used internally to resolve Admin Insights dataset LUIDs
- [Query Projects (REST)](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_projects.htm#query_projects)
  — used internally for `stale-content` to resolve project LUIDs to names
- [Get User on Site (REST)](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#get_user_on_site)
  — used internally for the admin gate

## Required arguments

### `kind`

Which admin-insights backend to query:
- `ts-events` — raw VDS query against TS Events
- `site-content` — raw VDS query against Site Content
- `job-performance` — raw VDS query against Job Performance
- `stale-content` — deterministic stale-content anti-join

### `query`

**Required when `kind` is `ts-events`, `site-content`, or `job-performance`.**
Ignored when `kind` is `stale-content`.

A fully formed VDS [`query`](https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/QueryDatasource)
object: `fields`, `filters`, `parameters`. The schema mirrors the schema accepted by the
[`query-datasource`](../data-qna/query-datasource.md) tool.

Example (TS Events — last-access per item):

```json
{
  "kind": "ts-events",
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
      }
    ]
  },
  "limit": 500
}
```

## Optional arguments

### `limit`

The maximum number of rows to return. Applied when `kind` is `ts-events`, `site-content`, or
`job-performance`; **ignored** for `stale-content`.

The effective row limit is the **tightest** of:
1. The tool cap (`MAX_RESULT_LIMITS=query-admin-insights:N`)
2. The caller-supplied `limit`


See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit)

<hr />

### `minAgeDays`

**For `kind="stale-content"` only.** Minimum days since last access for content to be considered
stale. Falls back to the server-configured
[`STALE_CONTENT_MIN_AGE_DAYS`](../../configuration/mcp-config/env-vars.md), which defaults to `90`.

Range: `1`–`3650`.

Example: `30`

<hr />

### `projectIds`

**For `kind="stale-content"` only.** Optional list of project LUIDs to scope the report to.
Resolved to project names via the REST API. Invalid or out-of-scope LUIDs are reported in
`mcp.warnings` rather than silently dropped. If none resolve, the tool returns an empty report.

Example: `["af59ee84-a375-4cb4-84b9-eaa7864f59fb"]`

<hr />

### `itemTypes`

**For `kind="stale-content"` only.** Optional filter for item types. Defaults to
`["Workbook", "Datasource"]`.

Example: `["Datasource"]`

## Notes and caveats

- Tableau Cloud TS Events lookback caps at **90 days by default** (365 days with Advanced
  Management). Items beyond the lookback cannot be distinguished on last-access timestamps.
- Field captions differ between datasources — e.g. `Item Id` (TS Events) vs `Item ID` (Site
  Content). Inspect with [`get-datasource-metadata`](../data-qna/get-datasource-metadata.md)
  when in doubt.
- The `stale-content` backend excludes the Tableau-managed `Admin Insights` project by design.
- `Last Accessed At` is `null` for never-accessed items; the stale-content backend ages those
  from `Created At` and flags them `neverAccessed: true`.
- This tool intentionally bypasses the standard datasource access checker because Admin Insights
  datasources are internal/known and admin-gated independently.

## Example results

### Raw VDS query (`kind: "ts-events"`)

```json
{
  "data": [
    { "Item Id": "5092107", "Item Type": "Datasource", "last_access": "2026-04-15T00:00:00Z" },
    { "Item Id": "1412202", "Item Type": "Workbook", "last_access": "2026-05-08T21:12:45Z" }
  ]
}
```

### Stale-content report (`kind: "stale-content"`)

```json
{
  "thresholdDays": 90,
  "totalStaleItems": 2,
  "totalStaleSizeBytes": 5586253,
  "rows": [
    {
      "itemId": "1412202",
      "itemType": "Workbook",
      "itemName": "World Indicators",
      "project": "Samples",
      "ownerEmail": "owner@example.com",
      "createdAt": "2025-09-02T23:26:02",
      "updatedAt": "2025-09-02T23:26:02",
      "lastUsedDate": "2025-09-02T23:26:02",
      "daysSinceLastUse": 259,
      "size": 796179,
      "neverAccessed": true
    }
  ]
}
```

## Related

- [`delete-content`](../content/delete-content.md) — destructive-delete tool
