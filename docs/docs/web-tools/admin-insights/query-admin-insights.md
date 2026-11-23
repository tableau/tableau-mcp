---
sidebar_position: 5
---

# Query Admin Insights

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Queries the Tableau Cloud Admin Insights datasources on the current site and the deterministic
stale-content report through a single entry point. Dispatches on `kind` to one of five backends:

- `ts-events` — raw VDS query against the [`TS Events`](https://help.tableau.com/current/online/en-gb/adminview_insights_events.htm) datasource (audit events: access, publish,
  update, delete)
- `ts-users` — raw VDS query of per-user activity signals such as last login and Tableau Desktop /
  Prep last-access dates (_available November 2026 and later_)
- `site-content` — raw VDS query against the `Site Content` datasource (content metadata,
  ownership, sizes)
- `job-performance` — raw VDS query against the `Job Performance` datasource (extract refresh and
  subscription execution history)
- `stale-content` — server-side anti-join that returns already-filtered stale rows with no
  client-side math required. Subject to a server-side row cap
  ([`STALE_CONTENT_MAX_ROWS`](../../configuration/mcp-config/env-vars.md#stale_content_max_rows),
  default `100`) — see [Row cap](#row-cap-stale-content).

Field captions on the raw VDS kinds are dataset-specific and must match exactly; do not guess.
Known captions (_available November 2026 and later_): `ts-events` — Actor User Name, Event Type,
Event Date, Item Type, Item Name; `ts-users` — User Email, User Name, Tableau Desktop - Last Access
Date, Tableau Prep - Last Access Date; `site-content` — Item Type, Item Name, Owner Email, Item
Parent Project Name; `job-performance` — Item Name, Job Type, Job Result, Started At, Job Duration,
Job Execution Duration, Schedule Name, Was Manual Run, Error Message, Extract File Size.

:::warning[Admin Only]
Registered only when `ADMIN_TOOLS_ENABLED=true`. At request time it verifies the caller's site
role and rejects anything below `SiteAdministratorCreator` / `SiteAdministratorExplorer` /
`ServerAdministrator`. Admin Insights datasource LUIDs are resolved automatically; callers do not
pass `datasourceLuid`.
:::

## APIs called

This tool spans two Tableau API surfaces: it runs the datasource queries against the **VizQL Data
Service (VDS) API** and performs LUID/name resolution plus the admin gate against the **Tableau REST
API** (Tableau Cloud). Every request is admin-gated — the admin-gate read below runs first and
rejects non-administrators before any query is issued.

The MCP-layer OAuth gate requires the union of the scopes cited per operation below
(`tableau:viz_data_service:read`, `tableau:content:read`, and `tableau:users:read`) plus
`tableau:mcp_site_settings:read` to read per-site MCP configuration overrides (e.g.
[`STALE_CONTENT_MAX_ROWS`](../../configuration/mcp-config/env-vars.md#stale_content_max_rows),
[`STALE_CONTENT_MIN_AGE_DAYS`](../../configuration/mcp-config/env-vars.md#stale_content_min_age_days))
when MCP site settings are enabled.

- **Enforce the admin gate.** Reads the caller's user record to verify the site role and rejects
  anything below `SiteAdministratorCreator` / `SiteAdministratorExplorer` / `ServerAdministrator`
  before any query runs.
  - `GET /api/{version}/sites/{siteId}/users/{userId}` — read the caller's site role. Issued against
    the Tableau REST API; requires the `tableau:users:read` OAuth scope.
    [Query User on Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#query_user_on_site)
- **Resolve the Admin Insights dataset LUIDs.** Looks up the [`TS Events`](https://help.tableau.com/current/online/en-gb/adminview_insights_events.htm), `TS Users`, `Site Content`,
  and `Job Performance` datasource LUIDs by listing the datasources in the `Admin Insights` project, so
  callers never pass `datasourceLuid`.
  - `GET /api/{version}/sites/{siteId}/datasources` — list datasources filtered to the Admin Insights
    project. Issued against the Tableau REST API; requires the `tableau:content:read` OAuth scope.
    [Query Data Sources](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_sources)
- **Run the admin-insights query.** Issues the VDS query for the `ts-events`, `ts-users`,
  `site-content`, and `job-performance` kinds, and for the `stale-content` backend's Site Content read.
  - `POST /api/v1/vizql-data-service/query-datasource` — run the datasource query. Issued against the
    VizQL Data Service (VDS) API; requires the `tableau:viz_data_service:read` OAuth scope.
    [Query Data Source](https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/QueryDatasource)
- **Resolve project LUIDs to names** (`stale-content` only). Maps the caller's `projectIds` to
  project names before scoping the Site Content query.
  - `GET /api/{version}/sites/{siteId}/projects` — list projects to resolve LUIDs to names. Issued
    against the Tableau REST API; requires the `tableau:content:read` OAuth scope.
    [Query Projects](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_projects.htm#query_projects)

## Required arguments

### `kind`
Which admin-insights backend to query:

- `ts-events` — raw VDS query against [TS Events](https://help.tableau.com/current/online/en-gb/adminview_insights_events.htm) (audit events: access, publish, update, delete)
- `ts-users` — per-user last login and Tableau Desktop / Prep access (_available November 2026 and later_)
- `site-content` — raw VDS query against Site Content (content metadata, owners, size)
- `job-performance` — raw VDS query against Job Performance (extract-refresh and subscription run history)
- `stale-content` — a computed list of content with no recent access (Site Content minus everything
  recently accessed in [TS Events](https://help.tableau.com/current/online/en-gb/adminview_insights_events.htm))

#### Row cap (`stale-content`)

The `stale-content` backend limits how many individual stale items it returns in a single
call. This is a safety limit: the stale-content cleanup flow is destructive, so the tool
will not hand back a long list of items that a human has not reviewed yet. The limit is set
by [`STALE_CONTENT_MAX_ROWS`](../../configuration/mcp-config/env-vars.md#stale_content_max_rows)
(default `100`, range `1`–`10000`, overridable per-site and per-request).

- When the number of stale items is **at or below** the limit, the response includes the
  full `rows` array as usual
- When the number of stale items **exceeds** the limit, the response still succeeds but
  leaves out the itemized list. In that case the tool:
  - sets `rows` to an empty array (`rows: []`), so a caller cannot act on a large,
    unreviewed batch
  - still reports the real totals in `totalStaleItems` and `totalStaleSizeBytes`, so a
    read-only report can state how much stale content exists
  - adds a structured `ROW_CAP_EXCEEDED` warning (severity `ERROR`) to `mcp.warnings`,
    telling the caller to narrow the scope (for example, a specific `projectIds` subset or a
    higher `minAgeDays`) and run again

This is still a **successful** result, not an error. Only the itemized `rows` list is left
out — the totals and the warning are still returned, so you learn the size of the problem
without receiving the full list needed to act on it.

#### Stale-content behavior (`stale-content`)

**How the list is computed.** The backend starts from every item in Site Content and removes any
item that has a recent access event in [TS Events](https://help.tableau.com/current/online/en-gb/adminview_insights_events.htm); whatever remains — content with no recent access —
is reported as stale. (In SQL terms this "keep only the rows with no match on the other side"
operation is an anti-join.) The calculation is deterministic: the same site data and the same
`minAgeDays` always produce the same list, with no heuristics, scoring, or ranking.

- For Tableau Cloud instances, excludes the Tableau-managed []`Admin Insights` project](https://help.tableau.com/current/online/en-us/adminview_insights_manage.htm) by design.
- `Last Accessed At` is `null` for never-accessed items; the backend ages those from `Created At`
  and flags them `neverAccessed: true`.

:::note[Admin Insights data caveats]

- Tableau Cloud [TS Events](https://help.tableau.com/current/online/en-gb/adminview_insights_events.htm) lookback caps at **90 days by default** (365 days with Advanced
  Management). Items beyond the lookback cannot be distinguished on last-access timestamps.
- Field captions differ between datasources — e.g. `Item Id` ([TS Events](https://help.tableau.com/current/online/en-gb/adminview_insights_events.htm)) vs `Item ID` (Site
  Content). Inspect with [`get-datasource-metadata`](../data-qna/get-datasource-metadata.md)
  when in doubt.
- This tool intentionally bypasses the standard datasource access checker because Admin Insights
  datasources are internal/known and admin-gated independently.

:::

## Optional arguments

### `query`
**Required when `kind` is `ts-events`, `ts-users`, `site-content`, or `job-performance`.**
Ignored when `kind` is `stale-content`.

A fully formed VDS [`query`](https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/QueryDatasource)
object: `fields`, `filters`, `parameters`. The schema mirrors the schema accepted by the
[`query-datasource`](../data-qna/query-datasource.md) tool.

#### When `query` is omitted

`query` is optional only because the `stale-content` backend does not take one — it builds its
own Site Content query. Omitting it for a raw VDS `kind` is an error, not a shortcut:

- `kind` is `stale-content` — `query` is ignored whether you pass it or not, and the
  stale-content report is returned
- `kind` is `ts-events`, `ts-users`, `site-content`, or `job-performance` — the call fails before
  anything is queried, and no schema or field listing is returned in its place. To discover the
  fields a datasource exposes before querying it, use
  [`get-datasource-metadata`](../data-qna/get-datasource-metadata.md)

#### Example ([TS Events](https://help.tableau.com/current/online/en-gb/adminview_insights_events.htm) — last-access per item)

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

:::note
For `ts-events`, `ts-users`, `site-content`, or `job-performance`, omitting `query` is refused with `query is required when kind is "<kind>".`
:::

<hr />

### `limit`
The maximum number of rows to return. Applied when `kind` is `ts-events`, `ts-users`,
`site-content`, or `job-performance`; **ignored** for `stale-content`.

The effective row limit is the **tightest** of:

1. The tool cap (`query-admin-insights:N` in [`MAX_RESULT_LIMITS`](../../configuration/mcp-config/env-vars.md#max_result_limits))
2. The caller-supplied `limit`

See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit)

<hr />

### `minAgeDays`
**For `kind="stale-content"` only.** Minimum days since last access for content to be considered
stale. Falls back to the server-configured
[`STALE_CONTENT_MIN_AGE_DAYS`](../../configuration/mcp-config/env-vars.md#stale_content_min_age_days),
which defaults to `90`.

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
**For `kind="stale-content"` only.** Optional filter for item types. Allowed values: `Workbook`,
`Datasource`. Defaults to `["Workbook", "Datasource"]`.

Example: `["Datasource"]`

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

## Related

- [`delete-content`](../content/delete-content.md) — destructive-delete tool

{/* tool-details */}
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

## Row cap (`stale-content`)

The `stale-content` backend enforces a **server-side row cap** to protect the destructive
stale-content cleanup flow from acting on an unreviewed mass set. The cap is configured by
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

## Additional notes

- The `stale-content` backend excludes the Tableau-managed `Admin Insights` project by design.
- `Last Accessed At` is `null` for never-accessed items; the stale-content backend ages those
- The `stale-content` backend caps returned rows at
  (default `100`). Above the cap, `rows` is empty but `totalStaleItems` still reflects the true
  count and a `ROW_CAP_EXCEEDED` warning is attached — see [Row cap](#row-cap-stale-content).
- **A `401` or a "not found in the Admin Insights project" error does not necessarily mean Admin
  Insights is missing.** When multiple MCP servers are configured, the request may have reached the
  wrong or unauthenticated server. An `Authentication failed (401): ...` message is an
  authentication failure; the "not provisioned on the targeted Tableau Cloud site" message means
  Admin Insights is genuinely absent on the targeted site. See
  Running Multiple Servers & Diagnosing Auth Errors.

## Worked example

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
  ],
  "mcp": {
    "resultInfo": { "returnedCount": 1, "truncated": false }
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
{/* /tool-details */}
