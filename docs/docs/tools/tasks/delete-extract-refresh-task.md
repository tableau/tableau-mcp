---
sidebar_position: 2
---

# Delete Extract Refresh Task

Deletes an extract refresh task from the Tableau site. This permanently removes the scheduled extract refresh — the underlying data source or workbook is not affected, but it will no longer be refreshed on this schedule.

:::warning Admin Only
This tool is restricted to Tableau site administrators and requires the `ADMIN_TOOLS_ENABLED` environment variable to be enabled.
:::

:::danger Destructive Operation
This operation is irreversible. The extract refresh task cannot be recovered once deleted. To re-enable scheduled refreshes, a new task must be created.
:::

## Two-phase contract

The tool is **two-phase** to keep the destructive action safe. Both phases are the same tool call — they differ only by whether `confirm` is passed:

1. **Preview** (default — `confirm` omitted or `false`): echoes the task that would be deleted and returns a per-task `confirmationToken`. Does **not** call the Tableau delete endpoint.
2. **Delete** (`confirm: true` + `confirmationToken`): permanently deletes the task. The `confirmationToken` from the preview step is required — the delete is rejected without a matching token before any API call is made.

The `confirmationToken` is a friction gate that forces a deliberate second call rather than a blind one-shot delete. It is a deterministic hash of caller-known inputs (`sha256(siteId:taskId)[0..12]`), so it does not by itself prove a preview ran — it proves the caller performed two steps.

:::warning Human confirmation required — advisory, not enforced
Between the preview and the delete, the calling agent is instructed (via the tool description and the preview response) to surface the task identity to the user and obtain explicit approval before deleting. This human-approval step is a **prompt-level expectation, not a server guarantee**: the token gate forces two calls, but the server cannot observe whether a human actually approved. An agent that calls preview and then confirm itself satisfies the gate with no human in the loop.
:::

## APIs called

- [Delete Extract Refresh Task](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_extract_and_encryption.htm#delete_extract_refresh_task) (delete phase only; the preview phase makes no Tableau API call)

## Use cases

Use this tool when you need to:
- Remove a scheduled extract refresh that is no longer needed
- Disable refresh schedules for under-used or decommissioned content
- Optimize site resources by eliminating unnecessary extract refreshes

## Required permissions

- **Tableau Cloud**: Requires `tableau:tasks:delete` OAuth scope
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

| Parameter           | Type   | Required                       | Description                                                                                                                             |
| ------------------- | ------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `taskId`            | string (UUID) | Yes                     | The ID of the extract refresh task to delete. Obtain from `list-extract-refresh-tasks`.                                                 |
| `confirm`           | boolean | No (default `false`)          | When omitted or `false`, runs the preview. Set `true` to perform the delete — requires a matching `confirmationToken`.                  |
| `confirmationToken` | string | Required when `confirm: true`  | The token returned by the preview step for this `taskId`. The delete is rejected without a matching value before any API call is made. |

## Response

### Preview (`confirm` omitted or `false`)

Echoes the task and the token to use on the confirmed call. No Tableau API call is made.

```
Preview — would delete extract refresh task 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'. This is irreversible: once deleted, the task cannot be recovered and the underlying data source or workbook will no longer be refreshed on this schedule. NEXT STEP — REQUIRED: present this task to the user and obtain explicit approval. Do NOT delete without the user's approval in this conversation. Once approved, call again with confirm: true and confirmationToken: <token>.
```

### Delete (`confirm: true` + matching `confirmationToken`)

```
Extract refresh task 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' has been successfully deleted. The underlying data source or workbook is unaffected, but it will no longer be refreshed on this schedule.
```

## Error cases

| Scenario | Behavior |
| -------- | -------- |
| Task ID does not exist | Returns a 404 error |
| User is not a site administrator | Returns an error indicating admin permissions are required |
| `ADMIN_TOOLS_ENABLED` not set | Tool is not registered and unavailable to the client |
| `confirm: true` with missing or mismatched `confirmationToken` | Delete is rejected before any Tableau API call; response instructs the caller to run the preview first |
