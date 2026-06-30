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

## Two-phase confirm

The tool is **two-phase** to keep the destructive action safe:

1. **Preview** (default — `confirm` omitted or `false`): reports what would be deleted and returns a
   single-use **confirmation token**. Nothing is deleted.
2. **Delete** (`confirm: true`): permanently removes the task — but only if the `confirmationToken`
   from a prior preview call is supplied. The server verifies and consumes the token (single-use). The
   token is server-generated and unguessable, so this gate genuinely requires the preview phase to
   have run; it cannot be bypassed by computing a value.

Because an extract refresh task has no durable, taggable state, the confirmation token is held in an
in-memory registry (TTL configurable via `MUTATION_PREVIEW_TTL_MINUTES`, default 5). The registry is
not durable across a server restart or shared across instances; the only consequence is that a lost
token causes a confirm to be **rejected** (re-run the preview) — it can never wrongly allow a delete.

:::warning Human confirmation required
Between the preview and the delete, the calling agent is instructed (via the tool description and the
preview response) to surface the task to the user and obtain explicit approval before deleting. The
token gate guarantees the preview ran, but the **human approval** step is a prompt-level expectation —
agents must not auto-confirm.
:::

## MCP-Apps confirm panel (real human-in-the-loop)

When the off-by-default `mcp-apps` feature flag is enabled, this tool ships with an MCP App and the
preview phase renders an in-iframe **confirm panel** (the task id and a live countdown) instead of
returning a confirmation token the model could echo back. The permanent, irreversible delete is then
performed only when a person clicks **Delete task** in that panel, which invokes the model-invisible
`confirm-delete-extract-refresh-task` tool (`visibility: ['app']`). With the flag on, the model-driven
`confirm: true` path is **closed** — the assistant cannot delete on the user's behalf; the only route
to deletion is the human gesture. Because a task has no durable, taggable state, the human gesture
itself is the proof: the confirm tool verifies a fresh, single-use human approval recorded during the
preview (within `MUTATION_PREVIEW_TTL_MINUTES`, default 5); a missing or expired approval rejects the
delete. When the flag is off the tool behaves exactly as the two-phase `confirm`/`confirmationToken`
flow described above.

:::note[Authoritative audit]
Every mutation attempt — both the preview and the confirmed delete, and both allowed and denied
attempts (for example a non-admin caller, or a confirm with a missing/forged token) — emits a
structured authoritative audit record to the server's durable log sink (logger `audit`, level
`notice`), not just to the tool-response text. Each record captures the actor identity, the tool,
action, phase, the target id, the confirmation evidence kind (`registry-nonce` here, described but
never the raw token), and the result. This routing is centralized in the shared mutation guard so
every TMCP mutation tool audits identically.
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

| Parameter | Type   | Required | Description                                                                 |
| --------- | ------ | -------- | --------------------------------------------------------------------------- |
| `taskId`  | string | Yes      | The ID of the extract refresh task to delete. Obtain from `list-extract-refresh-tasks`. |
| `confirm` | boolean | No      | Set `true` to perform the deletion (requires `confirmationToken` from a prior preview). Defaults to preview. |
| `confirmationToken` | string | No | The single-use token returned by the preview call. Required when `confirm` is true. |

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
