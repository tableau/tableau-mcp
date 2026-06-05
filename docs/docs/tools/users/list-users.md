---
sidebar_position: 1
---

# List Users

Retrieves a list of users on the Tableau site. Each user includes profile information such as site role, email, last login time, and authentication settings.

:::warning Admin Only
This tool is restricted to Tableau site administrators and requires the `ADMIN_TOOLS_ENABLED` feature flag to be enabled.
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

Enable this tool by setting the feature flag:

```bash
ADMIN_TOOLS_ENABLED=true
```

See also: [Environment Variables](../../configuration/mcp-config/env-vars.md)

## Arguments

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `filter` | string | No | Client-side filter string with format `field:operator:value`. Multiple filters are comma-separated (AND logic). |
| `pageSize` | number | No | Number of results per page (client-side pagination after filtering) |
| `limit` | number | No | Maximum total results to return (client-side limit after filtering) |

:::note API Limitation
The Tableau REST API does not support server-side filtering or pagination for users. All users are fetched and filtering is performed client-side by this tool.
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
| `authSetting` | string | `eq`, `in` | `authSetting:eq:SAML` |
| `locale` | string | `eq`, `in` | `locale:eq:en_US` |
| `language` | string | `eq`, `in` | `language:eq:en` |

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

### Authentication Settings

Common values for `authSetting`:
- `ServerDefault` - Uses server's default authentication
- `SAML` - SAML-based SSO
- `OpenID` - OpenID Connect authentication

### Filter Examples

- Find all Creators: `siteRole:eq:Creator`
- Multiple roles: `siteRole:in:Creator|Explorer`
- Inactive users (no login in 6 months): `lastLogin:lt:2025-12-01T00:00:00Z`
- Unlicensed users: `siteRole:eq:Unlicensed`
- Combined filter for license reclamation: `siteRole:eq:Unlicensed,lastLogin:lt:2025-01-01T00:00:00Z`
- Users with SAML auth: `authSetting:eq:SAML`
- Find specific user by email: `email:eq:john.smith@example.com`

## Response structure

Each user includes:

- `id` – user ID (LUID)
- `name` – username (login name)
- `siteRole` – user's site role (see above for values)
- `email` – user email address
- `fullName` – user's full display name
- `lastLogin` – timestamp of last login (ISO 8601 format)
- `authSetting` – authentication method
- `locale` – user's locale setting (e.g., `en_US`, `en_GB`)
- `language` – user's language preference (e.g., `en`, `fr`, `de`)
- `externalAuthUserId` – ID from external authentication provider (if applicable)

## Example result

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
