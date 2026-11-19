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
