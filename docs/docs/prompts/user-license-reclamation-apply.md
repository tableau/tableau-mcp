---
sidebar_position: 5
---

# User License Reclamation — Apply

`user-license-reclamation-apply`

A guided, **destructive** Tableau Cloud admin workflow that identifies inactive licensed users, surfaces their owned-content counts for review, and — only after explicit human approval — downgrades approved users to **Unlicensed** via `update-user`.

:::warning[Admin Only · Destructive]
This prompt is restricted to Tableau site administrators and requires the `ADMIN_TOOLS_ENABLED` feature flag. It drives the destructive [`update-user`](../tools/users/update-user.md) tool. The user inventory, activity analysis, and ownership inventory steps are **read-only**: no user is downgraded until the admin approves a specific user set at the required human-in-the-loop confirmation break.
:::

## Workflow

The prompt sequences existing deterministic tools — it performs no calculations itself. Steps 1–3 are read-only; no write happens until after the Step 4 approval break:

1. **User inventory (read-only)** — calls [`list-users`](../tools/users/list-users.md) to retrieve all users on the site, then filters client-side to licensed roles in scope.
2. **Activity signals (read-only)** — calls [`query-admin-insights`](../tools/admin-insights/query-admin-insights.md) with `kind: "ts-events"` to determine each user's last login date. Users whose last login exceeds the `inactiveDays` threshold (or who have never logged in) are marked inactive.
3. **Ownership inventory (read-only)** — calls [`query-admin-insights`](../tools/admin-insights/query-admin-insights.md) with `kind: "site-content"` to count workbooks and data sources owned by each inactive user. This is informational only — ownership is **not** affected by the downgrade.
4. **Human confirmation break** — presents the inactive users as a table (username, display name, current role, last login, days inactive, owned workbooks, owned datasources) and requires explicit approval before any downgrade. In a dry run (the default) the workflow stops here.
5. **Apply (only after Step 4 approval)** — for each approved user, calls [`update-user`](../tools/users/update-user.md) with `siteRole: "Unlicensed"`. Calls are sequential; the first error stops the run.
6. **Final report** — prints a "Changes applied" section, a "Skipped" section, and an "Ownership reminder" noting that downgraded users' content remains intact and can be reassigned separately.

## Arguments

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `inactiveDays` | string (integer) | No | Minimum days since last login for a user to be considered inactive. Defaults to 90. |
| `siteRoles` | string | No | Comma-separated list of site roles to scope reclamation to (e.g. "Viewer, Explorer"). Defaults to all licensed roles (Creator, Explorer, ExplorerCanPublish, Viewer). |
| `userIds` | string | No | Comma-separated user LUIDs to scope the reclamation to. When omitted, all inactive users matching the criteria are analyzed. |
| `dryRun` | `"true"` \| `"false"` | No | When `true` (default), produces only the reclamation report — never calls `update-user`. Set to `false` to allow the apply step after the confirmation break. |

## Safety guarantees

- No user is downgraded until the admin approves a specific user set at the Step 4 break.
- The workflow only downgrades users the admin explicitly approved; unapproved users are never touched.
- Downgrading to Unlicensed does **not** delete or reassign content — ownership is retained.
- `update-user` is reversible by re-assigning the user's prior site role.
- Apply calls run sequentially; the first error stops the run so the admin can review partial state.

## Configuration

```bash
ADMIN_TOOLS_ENABLED=true
```

See also: [Environment Variables](../configuration/mcp-config/env-vars.md)
