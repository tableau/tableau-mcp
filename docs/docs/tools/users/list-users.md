---
sidebar_position: 1
---

# List Users

Retrieves a list of users on the Tableau site. Each user includes profile information such as site role, email, full name, and last login time.

:::warning[Admin Only]
This tool is restricted to Tableau site administrators and requires the `ADMIN_TOOLS_ENABLED` environment variable to be enabled.
:::

## APIs called

- [Get Users on Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#get_users_on_site)

## Use cases

Use this tool when you need to:
- Identify inactive users for license reclamation
- Audit user site roles and permissions
- Find users by email, name, or site role
- Review user authentication settings
- Analyze user activity based on last login times

## Required permissions

- **Tableau Cloud**: Requires `tableau:users:read` OAuth scope
- **Tableau Server**: Site or server administrators
- **Site Role**: Must be one of:
  - SiteAdministratorCreator
  - SiteAdministratorExplorer  
  - ServerAdministrator

## Configuration

Enable this tool by setting:

```bash
ADMIN_TOOLS_ENABLED=true
```

See also: [Environment Variables](../../configuration/mcp-config/env-vars.md)

## Arguments

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `filter` | string | No | Client-side filter string with format `field:operator:value`. Multiple filters are comma-separated (AND logic). |
| `pageSize` | number | No | Number of users to fetch from the API per page (default 100, max 1000) |
| `limit` | number | No | Maximum number of **matching** users to return. `limit` bounds results **after** `filter` is applied — the tool keeps paging until it has `limit` filter-matches (or the site is exhausted), so `limit:5` with an inactivity filter returns the first 5 matching users, never 5 pre-filter rows that all get filtered away. |

:::note[API Limitation]
The Tableau REST API does not support server-side filtering or pagination for users. All users are fetched and filtering is performed client-side by this tool.
:::

:::note[Never-logged-in users]
Tableau emits no `lastLogin` value for users who were provisioned but have never signed in. Because these users are the most inactive, a `lastLogin:lt:<date>` or `lastLogin:lte:<date>` (inactivity) filter **includes** them, while `lastLogin:gt:`/`gte:`/`eq:` filters exclude them. This makes never-logged-in users discoverable as license-reclamation candidates.
:::

## Filterable Fields

| Field | Type | Operators | Example |
|-------|------|-----------|---------|
| `id` | string | `eq`, `in` | `id:eq:abc123` |
| `name` | string | `eq`, `in` | `name:eq:jsmith` |
| `siteRole` | string | `eq`, `in` | `siteRole:eq:Creator` |
| `email` | string | `eq`, `in` | `email:eq:user@example.com` |
| `fullName` | string | `eq`, `in` | `fullName:eq:John Smith` |
| `lastLogin` | string (ISO 8601) | `eq`, `gt`, `gte`, `lt`, `lte` | `lastLogin:lt:2025-01-01T00:00:00Z` |

Only the fields above are filterable — they match the attributes this tool requests from Tableau. Filtering on any other field (e.g. `authSetting`, `locale`, `language`) is rejected with a validation error.

### Site Roles

Common values for `siteRole`:
- `ServerAdministrator` - Full server-level admin
- `SiteAdministratorCreator` - Site admin with Creator license
- `SiteAdministratorExplorer` - Site admin with Explorer license
- `Creator` - Can author and publish
- `Explorer` - Can view and interact
- `ExplorerCanPublish` - Explorer with publish permissions
- `Viewer` - View-only access
- `Unlicensed` - No active license
- `Guest` - Guest user (limited access)

### Filter Examples

- Find all Creators: `siteRole:eq:Creator`
- Multiple roles: `siteRole:in:Creator|Explorer`
- Inactive users (no login in 6 months): `lastLogin:lt:2025-12-01T00:00:00Z`
- Unlicensed users: `siteRole:eq:Unlicensed`
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
  - `"requested-limit"` – the `limit` you passed cut the result short. Call again with a higher `limit` (or omit it) to get more.
  - `"admin-cap"` – a site-administrator per-call cap (`MAX_RESULT_LIMIT[S]`) cut the result short. `limit` cannot raise it, so either narrow the `filter` so the matching set fits, or ask an administrator to raise the cap.

:::note[`limit` bounds matches, not fetched rows]
Because filtering is client-side, `limit` bounds the number of users that **match the filter**, not the number of raw rows fetched from the API. The tool keeps paging until it has collected `limit` matching users (or the site is exhausted). A limit-truncated filtered list is reported via `mcp.resultInfo.truncated: true` rather than silently appearing complete.
:::

:::note[Output fields]
This tool returns a lean, fixed field set: `id`, `name`, `fullName`, `siteRole`, `email`, and `lastLogin`. Tableau's REST API may return additional attributes (such as `authSetting`, `locale`, `language`), but the tool strips them from its output; only the six fields above appear.
:::

## Example result

```json
{
  "users": [
    {
      "id": "user-abc123",
      "name": "jsmith",
      "siteRole": "Creator",
      "email": "john.smith@example.com",
      "fullName": "John Smith",
      "lastLogin": "2026-05-20T10:30:00Z"
    },
    {
      "id": "user-def456",
      "name": "asmith",
      "siteRole": "Viewer",
      "email": "alice.smith@example.com",
      "fullName": "Alice Smith",
      "lastLogin": "2026-05-15T08:00:00Z"
    },
    {
      "id": "user-ghi789",
      "name": "bjones",
      "siteRole": "Unlicensed",
      "email": "bob.jones@example.com",
      "fullName": "Bob Jones",
      "lastLogin": "2024-12-01T12:00:00Z"
    }
  ],
  "mcp": {
    "resultInfo": {
      "returnedCount": 3,
      "truncated": true,
      "truncationReason": "requested-limit"
    }
  }
}
```

## Empty result

If no users are found, the tool returns a message:

```
No users were found. Either none exist or you do not have permission to view them.
```

## Use Case: License Reclamation

This tool is particularly useful for identifying candidates for license reclamation (JTBD #3 from the Admin Tools roadmap):

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
