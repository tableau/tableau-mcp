---
sidebar_position: 1
---

# Delete Content

Permanently deletes a workbook, published data source, or extract refresh task. Dispatches on
`resourceType`:

- `workbook` — deletes a workbook (recoverable via recycle bin on Tableau Cloud)
- `datasource` — deletes a published data source (recoverable via recycle bin; warns on downstream dependents)
- `extract-refresh-task` — deletes an extract refresh task schedule (permanent, not recoverable)

The tool is **admin-only** — it is registered only when `ADMIN_TOOLS_ENABLED=true`, and at
request time it verifies the caller's site role and rejects anything below
`SiteAdministratorCreator` / `SiteAdministratorExplorer` / `ServerAdministrator`.


## Two-phase safety

The tool is **two-phase** to keep the destructive action safe:

1. **Preview** (default — `confirm` omitted or `false`):
   - For `workbook` / `datasource`: tags the resource with `pending-deletion` (reversible,
     visible in the Tableau UI), reports identity, project, and owner.
   - For `extract-refresh-task`: first verifies the task exists on the site (there is no single-get
     endpoint, so the task list is checked for a matching id) — an unknown `taskId` returns a
     not-found error and **no** `confirmationToken` is minted. When the task exists, mints a
     single-use `confirmationToken` and reports task metadata.
   - Does **not** delete anything.

2. **Confirm** (`confirm: true`):
   - For `workbook` / `datasource`: re-fetches the resource and verifies the pending-deletion
     tag is present before deleting (server-authoritative gate — cannot be bypassed by guessing).
   - For `extract-refresh-task`: verifies the `confirmationToken` matches the nonce from the
     preview.
   - Performs the deletion.

:::warning Human confirmation required
Between the preview and the confirm, the calling agent is instructed to surface the resource
identity to the user and obtain explicit approval. This is a prompt-level expectation; the
tag/nonce gate proves a preview ran but cannot observe whether a human actually approved.

When the `mcp-apps` feature flag is enabled, the model-driven `confirm: true` path is **closed**
entirely — deletion requires a human gesture in the in-iframe confirm panel.
:::

## Tool scoping

This tool honors the same [tool-scoping](../../configuration/mcp-config/tool-scoping.md) rules as
the read tools. If the server is configured with a bounded context (`INCLUDE_WORKBOOK_IDS`,
`INCLUDE_PROJECT_IDS`, `INCLUDE_DATASOURCE_IDS`, `INCLUDE_TAGS`), a resource outside that scope
cannot be previewed or deleted — the request is rejected before any side effects.

## APIs called

### Workbook

- [Add Tags to Workbook](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#add_tags_to_workbook) (preview)
- [Query Workbook](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbook) (preview + confirm verification)
- [Delete Workbook](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#delete_workbook) (confirm)

### Datasource

- [Add Tags to Data Source](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#add_tags_to_data_source) (preview)
- [Query Data Source](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_source) (preview + confirm verification)
- [Delete Data Source](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#delete_data_source) (confirm)
- [Metadata API — lineage query](https://help.tableau.com/current/api/metadata_api/en-us/index.html) (preview — downstream-dependent warning)

### Extract Refresh Task

- [List Extract Refresh Tasks](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_jobs_tasks_and_schedules.htm#list_extract_refresh_tasks) (preview + confirm — existence check, since there is no single-get endpoint)
- [Delete Extract Refresh Task](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_extract_and_encryption.htm#delete_extract_refresh_task) (confirm)

### Common

- [Get User on Site (REST)](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#get_user_on_site) — admin gate

## Required arguments

### `resourceType`

The kind of resource to delete: `"workbook"`, `"datasource"`, or `"extract-refresh-task"`.

### `resourceId`

The LUID of the workbook or data source, or the UUID of the extract refresh task.

Example: `"222ea993-9391-4910-a167-56b3d19b4e3b"`

## Optional arguments

### `confirm`

When omitted or `false`, runs the non-destructive preview. When `true`, permanently deletes —
but only if the prior-preview evidence is present (tag for workbook/datasource,
`confirmationToken` for extract-refresh-task).

Example: `true`

<hr />

### `tag`

**For `resourceType="workbook"` or `"datasource"` only.** The pending-deletion tag label.
Reversible and visible in the Tableau UI. Defaults to `pending-deletion`.

Example: `"stale-pending-deletion"`

<hr />

### `confirmationToken`

**For `resourceType="extract-refresh-task"` only.** The single-use token returned by a prior
preview call. Required when `confirm` is `true`; ignored otherwise.

## Audit records and durability

Every mutation attempt — allowed, denied, completed, or failed — emits a single authoritative,
structured-JSON audit record (actor, tool, action, phase, target identity, evidence kind, result) on
a dedicated `audit` logger. That logger bypasses the `LOG_LEVEL` severity filter, so an operator
cannot suppress security-audit records by raising `LOG_LEVEL`. For an extract-refresh-task target,
the record's `name`/`project`/`owner` derive best-effort from the task's underlying data source or
workbook (the task itself has no such fields); if that lookup fails the record still carries the task
id.

**Durability is the deployment's responsibility.** The server only emits these records to its log
stream (stderr/stdout/file). To retain them, operators must ship that audit-logger stream to a
durable, ideally immutable, log store (SIEM, log archive, etc.). There is no built-in durable audit
sink in this server.

## Side effects

- **Preview (workbook/datasource)** adds the pending-deletion tag. Reversible.
- **Preview (extract-refresh-task)** mints an ephemeral nonce (no visible side effect on the task).
- **Confirm (workbook/datasource)** removes the resource. On Tableau Cloud it goes to the
  [recycle bin](https://help.tableau.com/current/pro/desktop/en-us/recycle_bin.htm) and can be
  restored for a limited time.
- **Confirm (extract-refresh-task)** permanently deletes the task schedule. Not recoverable.

## Example

### Preview a workbook deletion

```json
{
  "resourceType": "workbook",
  "resourceId": "222ea993-9391-4910-a167-56b3d19b4e3b"
}
```

### Confirm the deletion

```json
{
  "resourceType": "workbook",
  "resourceId": "222ea993-9391-4910-a167-56b3d19b4e3b",
  "confirm": true
}
```

## Related

- [`query-admin-insights`](../admin-insights/query-admin-insights.md) — admin-insights query tool
