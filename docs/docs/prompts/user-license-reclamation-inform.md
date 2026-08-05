---
sidebar_position: 5
---

# User License Reclamation — Inform

`user-license-reclamation-inform`

A read-only Tableau Cloud admin workflow that identifies inactive licensed users who are candidates for downgrade to Unlicensed.

:::warning[Admin Only]
This prompt is restricted to Tableau site administrators and requires the `ADMIN_TOOLS_ENABLED` site setting.
:::

## Workflow

The prompt orchestrates two tool calls:

1. **`list-users`** — fetches all users matching the target site roles whose `lastLogin` is older than the inactivity threshold. The tool paginates the result set; note that if `MAX_RESULT_LIMIT` is configured, the fetch is capped and the role/lastLogin filter is applied client-side after fetch — some candidates beyond the cap may not appear.
2. **`query-admin-insights`** with `kind: "ts-events"` — cross-references Access events within the lookback window (capped at 90 days on standard Tableau Cloud) to exclude users who are active despite a stale `lastLogin` timestamp (e.g., API-only users).

The final output is a Markdown table of reclamation candidates with their site role, last login, days inactive, and auth setting. No user modifications are performed.

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

- `tableau:users:read` — for `list-users`
- `vds:read` — for `query-admin-insights`

## Notes

- TS Events caps at 90 days lookback on Tableau Cloud (365 days with Advanced Management).
- `lastLogin` reflects Tableau UI sign-in only — API-only or embedded users may show as inactive.
- Pair with `user-license-reclamation-apply` (coming soon) to act on the results.

See also: [Environment Variables](../configuration/mcp-config/env-vars.md)
