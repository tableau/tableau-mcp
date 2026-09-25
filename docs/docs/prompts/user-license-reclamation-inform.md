---
sidebar_position: 5
---

# User License Reclamation — Inform

`user-license-reclamation-inform`

A read-only Tableau Cloud admin workflow that identifies inactive licensed users who are candidates for downgrade to Unlicensed.

:::warning[Admin Only]
This prompt is restricted to Tableau site administrators and requires the `ADMIN_TOOLS_ENABLED` environment variable.
:::

## Workflow

The prompt orchestrates three tool calls:

1. **`list-users`** — fetches all users matching the target site roles whose `lastLogin` is older than the inactivity threshold. The role/`lastLogin` filter is applied by `list-users` as a filter, and the tool paginates the result set; note that if `MAX_RESULT_LIMIT` is configured as a site-wide cap, more matches may exist server-side than get returned — some candidates beyond the cap may not appear.
2. **`query-admin-insights`** with `kind: "ts-events"` — cross-references Access events within the lookback window (capped at 90 days on standard Tableau Cloud) to exclude users who are active despite a stale `lastLogin` timestamp (e.g., API-only users). The query is **scoped to the Step-1 candidates** via a SET filter on `Actor User Name` (the Tableau username, which equals the email on Tableau Cloud): the model replaces a placeholder in the query with the exact candidate names before issuing the call. Without this scope an unfiltered site-wide query on a large tenant is silently truncated to an arbitrary 10000-row slice, which can drop an active candidate's Access events and turn them into a false positive.
3. **`query-admin-insights`** with `kind: "ts-users"` — cross-references Tableau **Desktop** and **Prep** last-access dates (`Tableau Desktop - Last Access Date`, `Tableau Prep - Last Access Date`), joined to candidates by `User Email` / `User Name`. Like the TS Events step, this query is **scoped to the Step-1 candidates** via a SET filter on `User Email` for the same truncation reason. A user with a recent **non-null** Desktop or Prep date is active and is excluded, even if their `lastLogin` is stale and they have no TS Events Access event. A `null` date is treated as "no signal" — the user remains a candidate.

The final output is a Markdown table of reclamation candidates with their site role, last login, and days inactive. No user modifications are performed.

## Arguments

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `inactiveDays` | string (integer) | No | Minimum days of inactivity. Defaults to 90. |
| `roles` | string | No | Comma-separated site roles to target. Defaults to `Creator,Explorer`. |

## Configuration

```bash
ADMIN_TOOLS_ENABLED=true

# Optional overrides (env vars)
LICENSE_RECLAIM_INACTIVE_DAYS=90
LICENSE_RECLAIM_ROLES=Creator,Explorer
```

## Scopes

This prompt uses existing scopes — no new scope registration is needed:

- `tableau:mcp:users:read` (MCP) and `tableau:users:read` (API) — for `list-users`
- `tableau:mcp:datasource:read` (MCP) and `tableau:viz_data_service:read` (API) — for `query-admin-insights`

## Notes

- TS Events caps at 90 days lookback on Tableau Cloud (365 days with Advanced Management).
- The TS Events and TS Users cross-reference queries are scoped to the Step-1 candidate set (SET filters on `Actor User Name` and `User Email` respectively) and are capped at 10000 rows. If a scoped query returns exactly 10000 rows the report warns that results were truncated. For TS Users, 0 rows signals the scope placeholder was not substituted (every user has a row); for TS Events, 0 rows is a valid "no recent activity" result but can also indicate an unsubstituted placeholder, so verify substitution before relying on it.
- `lastLogin` reflects Tableau UI sign-in only — API-only or embedded users may show as inactive.
- Tableau Desktop / Prep last-access dates (`kind: "ts-users"`) are populated only when the tenant collects Desktop/Prep telemetry. On tenants where this data is unavailable these fields are `null` for every user — a `null` date is treated as "no signal", never as activity, so a user active only in Desktop/Prep could still be flagged. The report appends a caveat when Desktop/Prep data appears unavailable.
- Pair with `user-license-reclamation-apply` to act on the results.

See also: [Environment Variables](../configuration/mcp-config/env-vars.md)
