---
sidebar_position: 2
---

# admin-users

Administrative tool for managing Tableau users, exposing non-SCIM user methods from the Tableau REST API.

## Operations

### User Lifecycle

- `add-user-to-site` - Add a new user to the site
- `remove-user-from-site` - Remove a user from the site  
- `update-user` - Update user properties
- `query-user-on-site` - Query a specific user by ID
- `get-users-on-site` - List all users on the site with optional filtering, sorting, and pagination
- `get-groups-for-user` - Get groups that a user belongs to

### Bulk Operations

- `import-users-to-site-from-csv` - Import multiple users from CSV
- `delete-users-from-site-with-csv` - Bulk delete users using CSV

### OAuth Credentials

- `upload-user-credentials` - Upload OAuth credentials for a user
- `download-user-credentials` - Download OAuth credentials for a user

## Parameters

- `operation` (required) - The operation to perform
- `userId` - User LUID (required for user-specific operations)
- `pageSize` - Number of results per page
- `pageNumber` - Page number for pagination
- `filter` - Tableau REST API filter syntax
- `sort` - Sort expression
- `fields` - Field selection
- `body` - Request body for create/update operations

## Required Scopes

- **MCP Scope**: `tableau:mcp:admin:users`
- **API Scopes** (operation-dependent):
  - `tableau:users:read` - Query operations
  - `tableau:users:create` - Add/import operations
  - `tableau:users:update` - Update operations
  - `tableau:users:delete` - Delete/remove operations
  - `tableau:oauth_credentials:upload` - Upload credentials
  - `tableau:oauth_credentials:download` - Download credentials

## Example Usage

```typescript
// Get all users on the site
{
  operation: "get-users-on-site",
  pageSize: 100
}

// Query a specific user
{
  operation: "query-user-on-site",
  userId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}

// Add a new user
{
  operation: "add-user-to-site",
  body: {
    user: {
      name: "john.doe@example.com",
      siteRole: "Viewer"
    }
  }
}
```

## References

- [Tableau REST API - Users and Groups](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm)
