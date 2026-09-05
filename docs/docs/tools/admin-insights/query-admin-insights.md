---
sidebar_position: 5
---

# Query Admin Insights

Queries the Tableau Cloud Admin Insights datasources and the deterministic stale-content
report through a single entry point. Dispatches on `kind` to one of five backends:

- `ts-events` — raw VDS query against the `TS Events` datasource (audit events: access, publish,
  update, delete)
- `ts-users` — raw VDS query against the `TS Users` datasource (per-user activity signals: last
  login, days since last login, and Tableau Desktop / Prep / Web Authoring last-access dates)
- `site-content` — raw VDS query against the `Site Content` datasource (content metadata,
  ownership, sizes)
- `job-performance` — raw VDS query against the `Job Performance` datasource (extract refresh and
  subscription execution history)
- `stale-content` — server-side anti-join that returns already-filtered stale rows with no
  client-side math required. Subject to a server-side row cap
  ([`STALE_CONTENT_MAX_ROWS`](../../configuration/mcp-config/env-vars.md#stale_content_max_rows),
  default `100`) — see [Row cap](#row-cap-stale-content).

:::warning[Admin Only]
This tool is restricted to Tableau site administrators and requires the `ADMIN_TOOLS_ENABLED` environment variable to be enabled.
:::

Admin Insights datasource LUIDs are resolved automatically; callers do not pass `datasourceLuid`.

## Datasource resolution and duplicate handling

Each `kind` maps to a system-provisioned Admin Insights datasource (`TS Events`, `TS Users`,
`Site Content`, `Job Performance`). The tool resolves that name to a LUID at request time and caches
the result per site.

On most sites there is exactly one datasource per name and resolution is a single REST call. Some
sites, however, contain **cloned Admin Insights content** or a duplicate `Admin Insights` project —
so several published datasources share the same name, and one of them may be a broken copy with a
dead extract (a query against it fails with a Hyper connection error). To pick the canonical,
system-provisioned datasource in that case, the resolver:

1. narrows the candidates to the top-level `Admin Insights` project;
2. ranks the survivors on free datasource-payload signals — certification, a canonical
   `contentUrl` slug (a cloned copy carries a `_<epoch-ms>` suffix), and a non-empty description —
   and, only to break a residual tie, the owner being the non-enumerable **Tableau System Account**;
   oldest `createdAt` is the final tie-break;
3. picks the best-ranked candidate and, if a query against it fails with a Hyper connection error at
   runtime, negative-caches that LUID and retries the next-ranked candidate.

When more than one candidate exists, the result carries a diagnostic warning under `mcp.warnings`
(`ADMIN_INSIGHTS_AMBIGUOUS_DATASOURCE`, or `ADMIN_INSIGHTS_DATASOURCE_UNHEALTHY` when a dead extract
forced a fallback) naming the duplicates and which was chosen, so an admin can delete the
non-canonical copy to remove the ambiguity.

If automatic resolution ever picks the wrong datasource, a site administrator can pin the LUID per
dataset name via the [`ADMIN_INSIGHTS_DATASET_LUIDS`](../../configuration/mcp-config/env-vars.md)
config — a JSON object keyed by dataset name, e.g.
`{"Site Content": "9c8f1e2a-4b3d-4c5e-8f6a-1b2c3d4e5f6a"}`. A pinned LUID is used verbatim and skips
both discovery and the health-check fallback.

## APIs called

- [Query Datasource (VDS)](https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/QueryDatasource)
  — issues the VDS query for `ts-events`, `site-content`, `job-performance`, and the `stale-content` backend
- [Query Data Sources (REST)](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_sources)
  — used internally to resolve Admin Insights dataset LUIDs
- [Query Projects (REST)](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_projects.htm#query_projects)
  — used internally for `stale-content` to resolve project LUIDs to names, and to locate the
  canonical top-level `Admin Insights` project when disambiguating duplicate datasources
- [Get User on Site (REST)](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#get_user_on_site)
  — used internally for the admin gate, and (only on a residual tie between duplicate datasources)
  to check whether a candidate's owner is the Tableau System Account

## Required arguments

### `kind`

Which admin-insights backend to query:
- `ts-events` — raw VDS query against TS Events
- `ts-users` — raw VDS query against TS Users
- `site-content` — raw VDS query against Site Content
- `job-performance` — raw VDS query against Job Performance
- `stale-content` — deterministic stale-content anti-join

### `query`

**Required when `kind` is `ts-events`, `ts-users`, `site-content`, or `job-performance`.**
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

The maximum number of rows to return. Applied when `kind` is `ts-events`, `ts-users`,
`site-content`, or `job-performance`; **ignored** for `stale-content`.

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

## Row cap (`stale-content`)

The `stale-content` backend enforces a **server-side row cap** to protect the destructive
stale-content cleanup flow from acting on an unreviewed mass set. The cap is configured by
[`STALE_CONTENT_MAX_ROWS`](../../configuration/mcp-config/env-vars.md#stale_content_max_rows)
(default `100`, range `1`–`10000`; overridable per-site and per-request).

When the stale-item count is **at or below** the cap, the full `rows` array is returned as usual.

When the count **exceeds** the cap, the tool:

- returns an empty `rows` array (`rows: []`) — the row payload is withheld so a caller cannot act on
  an unreviewed batch;
- still reports the **true** pre-cap totals in `totalStaleItems` and `totalStaleSizeBytes`, so a
  read-only report can state the magnitude;
- appends a structured `ROW_CAP_EXCEEDED` warning (severity `ERROR`) to `mcp.warnings` guiding the
  caller to narrow scope (e.g. a specific `projectIds` subset or a higher `minAgeDays`) and re-run.

This is a **successful** result, not an error — only the row payload is withheld.

## Notes and caveats

- Tableau Cloud TS Events lookback caps at **90 days by default** (365 days with Advanced
  Management). Items beyond the lookback cannot be distinguished on last-access timestamps.
- Field captions differ between datasources — e.g. `Item Id` (TS Events) vs `Item ID` (Site
  Content). Inspect with [`get-datasource-metadata`](../data-qna/get-datasource-metadata.md)
  when in doubt.
- The `stale-content` backend excludes the Tableau-managed `Admin Insights` project by design.
- `Last Accessed At` is `null` for never-accessed items; the stale-content backend ages those
  from `Created At` and flags them `neverAccessed: true`.
- The `stale-content` backend caps returned rows at
  [`STALE_CONTENT_MAX_ROWS`](../../configuration/mcp-config/env-vars.md#stale_content_max_rows)
  (default `100`). Above the cap, `rows` is empty but `totalStaleItems` still reflects the true
  count and a `ROW_CAP_EXCEEDED` warning is attached — see [Row cap](#row-cap-stale-content).
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

### Raw VDS query (`kind: "ts-users"`)

`TS Users` carries one row per user with per-user activity signals. Useful captions include
`User Email` (the join key against a REST API user's email), `User Name`, `Last Login Date`,
`Days Since Last Login`, `Tableau Desktop - Last Access Date`, `Tableau Prep - Last Access Date`,
and `Web Authoring - Last Access Date`.

:::note
The Tableau Desktop / Prep last-access dates are populated only when the tenant collects Desktop /
Prep telemetry. On tenants where that data is unavailable these fields are `null` for every user —
a `null` value therefore means "no signal", **not** "inactive". Treat a recent non-null value as an
activity signal, but never treat a `null` as evidence of inactivity.
:::

```json
{
  "kind": "ts-users",
  "query": {
    "fields": [
      { "fieldCaption": "User Email" },
      { "fieldCaption": "Last Login Date" },
      { "fieldCaption": "Tableau Desktop - Last Access Date" },
      { "fieldCaption": "Tableau Prep - Last Access Date" }
    ]
  },
  "limit": 10000
}
```

Example result:

```json
{
  "data": [
    {
      "User Email": "creator@example.com",
      "Last Login Date": "2026-05-01T12:00:00Z",
      "Tableau Desktop - Last Access Date": "2026-07-28T09:14:00Z",
      "Tableau Prep - Last Access Date": null
    }
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
      "itemLuid": "9c8f1e2a-4b3d-4c5e-8f6a-1b2c3d4e5f6a",
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

### Stale-content report above the row cap (`kind: "stale-content"`)

```json
{
  "thresholdDays": 90,
  "totalStaleItems": 3376,
  "totalStaleSizeBytes": 894837291,
  "rows": [],
  "mcp": {
    "warnings": [
      {
        "type": "ROW_CAP_EXCEEDED",
        "severity": "ERROR",
        "message": "Found 3376 stale items, which exceeds the server-configured cap of 100 (STALE_CONTENT_MAX_ROWS). The row payload was withheld to prevent acting on an unreviewed mass set; totalStaleItems reflects the true count. Narrow the scope (e.g. a specific projectIds subset or a higher minAgeDays) and re-run to receive rows.",
        "totalStaleItems": 3376,
        "maxRows": 100,
        "reason": "over-row-cap"
      }
    ]
  }
}
```

## Output formatting

This tool returns raw JSON. Any table rendering (Markdown, Slack) is performed by the AI
client, not the server, so it lives only in the current conversation. When
`ADMIN_TOOLS_ENABLED` is set, the server's `initialize` instructions nudge clients to present
admin/list results as Markdown tables by default — but this is best-effort (hosts that ignore
`initialize.instructions` get no nudge) and does not pin a specific column set or style.

For a **durable, exact** output style that survives across sessions, set it in your MCP client's
own memory (e.g. a line in Claude Code / Claude Desktop `CLAUDE.md`), for example:

> When showing Tableau admin/list results, render a Markdown table with columns
> Full Name · Site Role · Email · Last Login; wrap emails in backticks; show "never" for a
> missing last login.

The server has no per-user preference store, so this persistence is necessarily a client concern.

## Related

- [`delete-content`](../content/delete-content.md) — destructive-delete tool
