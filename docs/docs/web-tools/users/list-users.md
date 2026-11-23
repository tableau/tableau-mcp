---
sidebar_position: 1
---

# List Users

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Retrieves a list of users on the Tableau site. Each user includes profile information such as site role, email, last login time, and authentication settings.

Use this tool when you need to:

- Identify inactive users for license reclamation
- Audit user site roles and permissions
- Find users by email, name, or site role
- Review user authentication settings
- Analyze user activity based on last login times


:::warning[Admin Only]
Registered only when [`ADMIN_TOOLS_ENABLED`](../../configuration/mcp-config/env-vars.md#admin_tools_enabled)`=true`; the caller's site role is verified at request time and must be `SiteAdministratorCreator`, `SiteAdministratorExplorer`, or `ServerAdministrator`.
:::

## APIs called

This tool reads users on the Tableau site through the **Tableau REST API** (Tableau Cloud or Server). Pagination is handled server-side (the tool fetches one page at a time); any `filter` is applied client-side after fetching. The MCP-layer OAuth scope for this tool is `tableau:mcp:users:read`.

- Verifies the caller is a site administrator by reading the caller's own user record (cached briefly per session).
  - `GET /api/{version}/sites/{siteId}/users/{userId}` — read the caller's site role for the admin check. Issued against the Tableau REST API; requires the `tableau:users:read` OAuth scope. [Query User On Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#query_user_on_site)
- Fetches the users on the site, one page at a time, until the requested limit is reached.
  - `GET /api/{version}/sites/{siteId}/users` — list users on the site. Issued against the Tableau REST API; requires the `tableau:users:read` OAuth scope. [Query Users on Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#query_users_on_site)

## Optional arguments

### `filter`

Client-side filter string with the format `field:operator:value`. Multiple filters are comma-separated (AND logic), and the same field can appear multiple times for range queries (e.g. `lastLogin:gt:X,lastLogin:lt:Y`). Filtering is applied by this tool after users are fetched from the API.

:::note[API limitation]
The Tableau REST API does not support server-side filtering of users, so all matching pages are fetched and filtering is performed client-side by this tool.
:::

#### Filterable fields

| Field | Type | Operators | Example |
|-------|------|-----------|---------|
| `id` | string | `eq`, `in` | `id:eq:abc123` |
| `name` | string | `eq`, `in` | `name:eq:jsmith` |
| `siteRole` | string | `eq`, `in` | `siteRole:eq:Creator` |
| `email` | string | `eq`, `in` | `email:eq:user@example.com` |
| `fullName` | string | `eq`, `in` | `fullName:eq:John Smith` |
| `lastLogin` | string (ISO 8601) | `eq`, `gt`, `gte`, `lt`, `lte` | `lastLogin:lt:2025-01-01T00:00:00Z` |
| `authSetting` | string | `eq`, `in` | `authSetting:eq:SAML` |
| `locale` | string | `eq`, `in` | `locale:eq:en_US` |
| `language` | string | `eq`, `in` | `language:eq:en` |
| `externalAuthUserId` | string | `eq`, `in` | `externalAuthUserId:eq:ext-123` |

#### Site roles

Common values for `siteRole`:

- `ServerAdministrator` — full server-level admin
- `SiteAdministratorCreator` — site admin with Creator license
- `SiteAdministratorExplorer` — site admin with Explorer license
- `Creator` — can author and publish
- `Explorer` — can view and interact
- `ExplorerCanPublish` — Explorer with publish permissions
- `Viewer` — view-only access
- `Unlicensed` — no active license
- `Guest` — guest user (limited access)

#### Authentication settings

Common values for `authSetting`:

- `ServerDefault` — uses the server's default authentication
- `SAML` — SAML-based SSO
- `OpenID` — OpenID Connect authentication

#### Filter examples

- Find all Creators: `siteRole:eq:Creator`
- Multiple roles: `siteRole:in:Creator|Explorer`
- Date range: `lastLogin:gt:2025-01-01T00:00:00Z,lastLogin:lt:2025-06-01T00:00:00Z`
- Unlicensed users: `siteRole:eq:Unlicensed`
- Users with SAML auth: `authSetting:eq:SAML`
- Find a specific user by email: `email:eq:john.smith@example.com`
- Unlicensed users with no login in 6+ months: `siteRole:eq:Unlicensed,lastLogin:lt:2025-11-01T00:00:00Z`
- All users who haven't logged in this year: `lastLogin:lt:2026-01-01T00:00:00Z`
- High-value licenses (Creator) with no recent activity: `siteRole:eq:Creator,lastLogin:lt:2025-12-01T00:00:00Z`

The last three are typical **license-reclamation** queries: the results can inform decisions about downgrading user licenses (Creator → Explorer → Viewer), removing unused licenses, or transferring content ownership before a user is removed.

#### Example

```json
{ "filter": "siteRole:eq:Unlicensed,lastLogin:lt:2025-01-01T00:00:00Z" }
```

<hr />

### `pageSize`

Number of users to fetch from the API per page. Controls the server-side pagination page size. Must be a positive integer. Defaults to `100`; the API maximum is `1000`.

#### Example

`100`

<hr />

### `limit`

Maximum total number of results to return after filtering. Must be a positive integer. The effective cap is the lower of this value and the tool's configured [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit) (or the per-tool [`MAX_RESULT_LIMITS`](../../configuration/mcp-config/env-vars.md#max_result_limits) entry, if set).

#### Example

`50`

## Example results

### Users found

Each user includes `id` (LUID), `name` (login name), `siteRole`, `email`, `fullName`, `lastLogin` (ISO 8601), `authSetting`, `locale`, `language`, and `externalAuthUserId` (if applicable):

```json
[
  {
    "id": "user-abc123",
    "name": "jsmith",
    "siteRole": "Creator",
    "email": "john.smith@example.com",
    "fullName": "John Smith",
    "lastLogin": "2026-05-20T10:30:00Z",
    "authSetting": "SAML",
    "locale": "en_US",
    "language": "en"
  },
  {
    "id": "user-def456",
    "name": "asmith",
    "siteRole": "Viewer",
    "email": "alice.smith@example.com",
    "fullName": "Alice Smith",
    "lastLogin": "2026-05-15T08:00:00Z",
    "authSetting": "ServerDefault",
    "locale": "en_GB",
    "language": "en"
  },
  {
    "id": "user-ghi789",
    "name": "bjones",
    "siteRole": "Unlicensed",
    "email": "bob.jones@example.com",
    "fullName": "Bob Jones",
    "lastLogin": "2024-12-01T12:00:00Z",
    "authSetting": "SAML",
    "locale": "en_US",
    "language": "en"
  }
]
```

### No users found

If no users match (or the caller lacks permission to view them), the tool returns a message:

```
No users were found. Either none exist or you do not have permission to view them.
```

## Related

- [`update-user`](update-user.md) — change a user's site role (e.g. downgrade a user found here to `Unlicensed`)

{/* tool-details */}
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
{/* /tool-details */}
