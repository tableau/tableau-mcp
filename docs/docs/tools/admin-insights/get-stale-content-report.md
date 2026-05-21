---
sidebar_position: 3
---

# Get Stale Content Report

Builds a deterministic report of stale Tableau Cloud content (workbooks and published
datasources) by querying the Admin Insights `Site Content` datasource — which exposes a
`Last Accessed At` field per item — applying the staleness threshold server-side, and returning
already-filtered rows.

The server applies the threshold comparison, optional project filter, and sort. Clients receive
only items where days since last use exceed the threshold. **No client-side math is required.**

The tool is admin-only — it is registered only when `TMCP_ADMIN_TOOLS_ENABLED=true`, and at request
time it verifies the caller's site role and rejects anything below
`SiteAdministratorCreator` / `SiteAdministratorExplorer` / `ServerAdministrator`.

## APIs called

- [Query Datasource (VDS)](https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/QueryDatasource) — single VDS call against the `Site Content` Admin Insights datasource
- [Query Data Sources (REST)](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_sources) — used internally to resolve the `Site Content` dataset LUID
- [Query Projects (REST)](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_projects.htm#query_projects) — used internally to resolve project LUIDs to names when a project scope is set
- [Get User on Site (REST)](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#get_user_on_site) — used internally for the admin gate

## Optional arguments

### `minAgeDays`

Minimum days since last access for content to be considered stale. The server applies the
condition `daysSinceLastUse > minAgeDays` (strict greater-than).

If omitted, falls back to the server-configured threshold
[`STALE_CONTENT_MIN_AGE_DAYS`](../../configuration/mcp-config/env-vars.md), which defaults to
`90` — the Tableau Cloud TS Events lookback ceiling.

Range: `1`–`3650`.

Example: `30`

<hr />

### `projectIds`

Optional list of project LUIDs to scope the report to. The server resolves the LUIDs to project
names via the Tableau REST API and filters the `Site Content` datasource by
`Item Parent Project Name`. The LUID → name lookup is cached for 5 minutes per site.

If omitted, falls back to the server-configured
[`INCLUDE_PROJECT_IDS`](../../configuration/mcp-config/env-vars.md) bound (if any). When both are
set, the final scope is the intersection.

Example: `["af59ee84-a375-4cb4-84b9-eaa7864f59fb"]`

<hr />

### `itemTypes`

Optional filter for item types. Defaults to `["Workbook", "Datasource"]`. Allowed values:
`Workbook`, `Datasource`.

Example: `["Datasource"]`

## Notes and caveats

- The Tableau-managed `Admin Insights` project is **excluded by design** — its datasources are
  admin-owned and refreshed by Tableau, not user content. The exclusion is enforced as a
  server-side VDS filter on `Item Parent Project Name`.
- `Last Accessed At` is `null` for items that have never been accessed. The report ages those
  items from `Created At` instead and flags them with `neverAccessed: true`.
- Rows are sorted descending by `daysSinceLastUse`, then by `size`.
- Tableau Cloud `Last Accessed At` is populated whenever the underlying `TS Events` access stream
  records an access — items beyond the 90-day Cloud event lookback may show `null` even if they
  were accessed earlier. Items with `daysSinceLastUse ≥ 90` should be interpreted accordingly.

## Example result

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
    },
    {
      "itemId": "5092116",
      "itemType": "Datasource",
      "itemName": "California Schools (frpm + schools)",
      "project": "default",
      "ownerEmail": "owner@example.com",
      "createdAt": "2026-01-13T22:22:19",
      "updatedAt": "2026-01-13T22:22:20",
      "lastUsedDate": "2026-01-13T22:22:19",
      "daysSinceLastUse": 126,
      "size": 4269845,
      "neverAccessed": true
    }
  ]
}
```

## Related

- [`query-admin-insights-site-content`](./query-admin-insights-site-content.md) — generic VDS
  wrapper this tool builds on; expose this tool's behavior as a generic Site Content query when
  ad-hoc field selections are needed.
- [`query-admin-insights-ts-events`](./query-admin-insights-ts-events.md) — TS Events sibling tool.
- The MCP prompt `stale-content-cleanup-inform` invokes this tool and renders the response as a
  Markdown table for HITL review.
