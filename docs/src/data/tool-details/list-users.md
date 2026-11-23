## Configuration

Enable this tool by setting:

See also: [Environment Variables](../../configuration/mcp-config/env-vars.md)

## Filterable Fields

Only the fields above are filterable — they match the attributes this tool requests from Tableau. Filtering on any other field (e.g. `authSetting`, `locale`, `language`) is rejected with a validation error.

- `ServerAdministrator` - Full server-level admin
- `SiteAdministratorCreator` - Site admin with Creator license
- `SiteAdministratorExplorer` - Site admin with Explorer license
- `Creator` - Can author and publish
- `Explorer` - Can view and interact
- `ExplorerCanPublish` - Explorer with publish permissions
- `Viewer` - View-only access
- `Unlicensed` - No active license
- `Guest` - Guest user (limited access)

- Inactive users (no login in 6 months): `lastLogin:lt:2025-12-01T00:00:00Z`
- Combined filter for license reclamation: `siteRole:eq:Unlicensed,lastLogin:lt:2025-01-01T00:00:00Z`
- Find specific user by email: `email:eq:john.smith@example.com`

## Response structure

Returns a JSON object `{ users: [...], mcp: { resultInfo: {...} } }`.

Each user in `users` includes:

- `id` – user ID (LUID)
- `name` – username (login name)
- `siteRole` – user's site role (see above for values)
- `email` – user email address
- `fullName` – user's full display name
- `lastLogin` – timestamp of last login (ISO 8601 format)

`mcp.resultInfo` is present on every non-empty result and reports the completeness of the (filtered) list (a filter matching zero users returns a plain message instead of this object):

- `returnedCount` – number of users in `users`.
- `truncated` – `false` means `users` is the **complete** set matching the filter; `true` means more matching users exist server-side than were returned.
- `truncationReason` (present only when `truncated` is `true`):
  - `"requested-limit"` – the `limit` you passed cut the result short. Call again with a higher `limit` to get more.
  - `"admin-cap"` – a site-administrator per-call cap (`MAX_RESULT_LIMIT[S]`) cut the result short. `limit` cannot raise it, so either narrow the `filter` so the matching set fits, or ask an administrator to raise the cap.
  - `"default-limit"` – you passed no `limit`, so the tool applied its default cap of `100`. This is a **partial** page, **not** site-wide totals; add a `filter` to target specific users or pass a higher `limit` (up to `1000`) to return more.
  - `"max-limit"` – your `limit` exceeded the per-call maximum of `1000` and was clamped to it. A single call cannot return more, and there is no page offset — neither a higher `limit` nor repeated calls advance past the ceiling; narrow the `filter` so fewer users match.
- `summary` – a plain-language sentence (always present) stating whether the list is complete or partial and, if partial, how to retrieve more. Relay it to the user; never report a `truncated` list as complete or as site-wide totals.

:::note[`limit` bounds matches, not fetched rows]
Because filtering is client-side, `limit` bounds the number of users that **match the filter**, not the number of raw rows fetched from the API. The tool keeps paging until it has collected `limit` matching users (or the site is exhausted). A limit-truncated filtered list is reported via `mcp.resultInfo.truncated: true` rather than silently appearing complete.
:::

:::note[Output fields]
This tool returns a lean, fixed field set: `id`, `name`, `fullName`, `siteRole`, `email`, and `lastLogin`. Tableau's REST API may return additional attributes (such as `authSetting`, `locale`, `language`), but the tool strips them from its output; only the six fields above appear.
:::

## Empty result

If no users are found, the tool returns a message:

## Use Case: License Reclamation

:::tip[Prefer the reclamation prompts for this job]
For "which licensed users are inactive / can we reclaim licenses" workflows, prefer the purpose-built `user-license-reclamation-inform` / `user-license-reclamation-apply` prompts (they add reclamation-specific analysis and human-in-the-loop safety) or `query-admin-insights` with `kind=ts-users`. Note that `list-users`' `lastLogin` reflects web sign-ins only and is blind to Tableau Desktop/Prep activity, so it can over-report a user as inactive. Use `list-users` to enumerate or inspect specific users; use the prompts to drive a reclamation decision.
:::

This tool can still help identify candidates for license reclamation (JTBD #3 from the Admin Tools roadmap):

```javascript
// Find unlicensed users who haven't logged in for 6+ months
filter: "siteRole:eq:Unlicensed,lastLogin:lt:2025-11-01T00:00:00Z"

// Find all users who haven't logged in this year
filter: "lastLogin:lt:2026-01-01T00:00:00Z"

// Find high-value licenses (Creator) with no recent activity
filter: "siteRole:eq:Creator,lastLogin:lt:2025-12-01T00:00:00Z"
```

The results can inform decisions about:
- Downgrading user licenses (Creator → Explorer → Viewer)
- Removing unused licenses
- Transferring content ownership before user removal
