---
sidebar_position: 3
---

# admin-groups

Administrative tool for managing Tableau groups, group sets, and group memberships.

## Operations

### Group Management

- `create-group` - Create a new group
- `delete-group` - Delete a group
- `update-group` - Update group properties
- `query-groups` - List groups with filtering and pagination
- `get-group` - Get details of a specific group

### Group Membership

- `add-user-to-group` - Add a user to a group
- `remove-user-from-group` - Remove a user from a group
- `get-users-in-group` - List users in a group

### Group Sets

- `create-group-set` - Create a new group set
- `update-group-set` - Update a group set
- `delete-group-set` - Delete a group set
- `add-group-to-group-set` - Add a group to a group set
- `remove-group-from-group-set` - Remove a group from a group set

## Parameters

- `operation` (required) - The operation to perform
- `groupId` - Group LUID
- `userId` - User LUID (for membership operations)
- `groupSetId` - Group set LUID
- `pageSize` - Results per page
- `pageNumber` - Page number
- `filter` - Filter expression
- `sort` - Sort expression
- `body` - Request body

## Required Scopes

- **MCP Scope**: `tableau:mcp:admin:groups`
- **API Scopes** (operation-dependent):
  - `tableau:groups:read` - Query operations
  - `tableau:groups:create` - Create operations
  - `tableau:groups:update` - Update operations  
  - `tableau:groups:delete` - Delete operations
  - `tableau:users:read` - Get users in group

## Example Usage

```typescript
// List all groups
{
  operation: "query-groups",
  pageSize: 50
}

// Add user to group
{
  operation: "add-user-to-group",
  groupId: "group-luid",
  userId: "user-luid"
}
```
