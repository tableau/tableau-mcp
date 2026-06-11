---
sidebar_position: 2
---

# Delete Extract Refresh Task

Deletes an extract refresh task from the Tableau site. This permanently removes the scheduled extract refresh — the underlying data source or workbook is not affected, but it will no longer be refreshed on this schedule.

:::warning Admin Only
This tool is restricted to Tableau site administrators and requires the `ADMIN_TOOLS_ENABLED` feature flag to be enabled.
:::

:::danger Destructive Operation
This operation is irreversible. The extract refresh task cannot be recovered once deleted. To re-enable scheduled refreshes, a new task must be created.
:::

## APIs called

- [Delete Extract Refresh Task](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_extract_and_encryption.htm#delete_extract_refresh_task)

## Use cases

Use this tool when you need to:
- Remove a scheduled extract refresh that is no longer needed
- Disable refresh schedules for under-used or decommissioned content
- Optimize site resources by eliminating unnecessary extract refreshes

## Required permissions

- **Tableau Cloud**: Requires `tableau:tasks:delete` OAuth scope
- **Tableau Server**: Non-admin users can delete tasks for which they have Read and Delete permissions
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

| Parameter | Type   | Required | Description                                                                 |
| --------- | ------ | -------- | --------------------------------------------------------------------------- |
| `taskId`  | string | Yes      | The ID of the extract refresh task to delete. Obtain from `list-extract-refresh-tasks`. |

## Response

A confirmation message indicating the task was successfully deleted:

```
Extract refresh task 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' has been successfully deleted. The underlying data source or workbook is unaffected, but it will no longer be refreshed on this schedule.
```

## Error cases

| Scenario | Behavior |
| -------- | -------- |
| Task ID does not exist | Returns a 404 error |
| User is not a site administrator | Returns an error indicating admin permissions are required |
| `ADMIN_TOOLS_ENABLED` not set | Tool is not registered and unavailable to the client |
