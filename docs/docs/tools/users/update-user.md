---
sidebar_position: 2
---

# Update User

Updates the site role of a user on the Tableau site. Primary use case: downgrade inactive users to "Unlicensed" to reclaim licenses.

:::warning Admin Only
This tool is restricted to Tableau site administrators and requires the `ADMIN_TOOLS_ENABLED` environment variable to be enabled.
:::

## Confirm and audit

This mutation is **two-phase**, gated on a server-generated single-use confirmation token:

1. **Preview** (default — `confirm` omitted or `false`): looks up the user, reports the current
   and proposed site role, and returns a single-use `confirmationToken`.
2. **Update** (`confirm: true` + `confirmationToken`): applies the role change. The server
   verifies and consumes the token first.

The token is server-generated and **bound to the previewed `userId` and `siteRole`**: a token minted
while previewing role A cannot confirm an update to role B, and a `confirm: true` with no prior
preview (no valid token) is rejected server-side. Present the change to the user and get explicit
approval before confirming.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `userId` | string | Yes | The LUID of the user to update. Obtain from `list-users`. |
| `siteRole` | enum | Yes | The new site role: `Creator`, `Explorer`, `ExplorerCanPublish`, `SiteAdministratorCreator`, `SiteAdministratorExplorer`, `Viewer`, `Unlicensed`. |
| `confirm` | boolean | No | Set `true` to apply the change (requires `confirmationToken`). |
| `confirmationToken` | string | No | The single-use token from a prior preview call. |

## Example usage

### Preview (dry run)

```json
{
  "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "siteRole": "Unlicensed"
}
```

Response:
```
Preview — user 'jsmith' (john.smith@example.com) would be changed from Creator → Unlicensed.
No change has been made.
Once approved, call again with confirm: true and confirmationToken: "..."
```

### Confirm

```json
{
  "userId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "siteRole": "Unlicensed",
  "confirm": true,
  "confirmationToken": "<token from preview>"
}
```

Response:
```
User 'jsmith' has been successfully updated. New site role: Unlicensed.
```

## OAuth scopes

- **MCP scope:** `tableau:mcp:users:write`
- **Tableau API scope:** `tableau:users:update`, `tableau:users:read`

## REST API reference

- [Update User](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#update_user) — `PUT /api/{version}/sites/{siteId}/users/{userId}`
