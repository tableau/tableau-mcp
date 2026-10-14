---
sidebar_position: 1
---

# Delete Content

Permanently deletes a workbook, published data source, or extract refresh task, and clears
pending-deletion markers (`action: "remove-pending-tags"`). Deletion dispatches on
`resourceType`:

- `workbook` — deletes a workbook (recoverable via recycle bin on Tableau Cloud)
- `datasource` — deletes a published data source (recoverable via recycle bin; warns on downstream dependents)
- `extract-refresh-task` — deletes an extract refresh task schedule (permanent, not recoverable)

:::warning[Admin Only]
This tool is restricted to Tableau site administrators and requires the `ADMIN_TOOLS_ENABLED` environment variable to be enabled.
:::

:::note[Tableau Cloud for workbooks and data sources]
Workbook and data source deletes re-check staleness against Admin Insights Site Content, which is
available only on Tableau Cloud. Where Admin Insights cannot be queried (e.g. Tableau Server), the
check fails closed and those deletes are rejected. Extract refresh task deletes are unaffected.
:::


## Two-phase safety

The tool is **two-phase** to keep the destructive action safe:

1. **Preview** (default — `confirm` omitted or `false`):
   - For `workbook` / `datasource`: re-checks that the item is still stale (Admin Insights Site
     Content, `minAgeDays` threshold), then tags it with the date-stamped cleanup-batch marker
     `pending-deletion-YYYY-MM-DD` (today's UTC date; reversible, visible in the Tableau UI) and
     reports identity, project, owner, and the `cleanupDate` to confirm with. An item that is no
     longer stale, or whose staleness cannot be verified, is rejected and **not** tagged.
   - For `extract-refresh-task`: first verifies the task exists on the site (there is no single-get
     endpoint, so the task list is checked for a matching id) — an unknown `taskId` returns a
     not-found error and **no** `confirmationToken` is minted. When the task exists, mints a
     single-use `confirmationToken` and reports task metadata.
   - Does **not** delete anything.

2. **Confirm** (`confirm: true`):
   - For `workbook` / `datasource`: re-fetches the resource and verifies it carries the marker of
     the batch named by `cleanupDate` (server-authoritative gate — cannot be bypassed by guessing).
     A marker from a different batch, or the legacy undated `pending-deletion` tag, does **not**
     authorize the delete. A batch older than the server's age limit
     ([`PENDING_DELETION_MAX_AGE_DAYS`](../../configuration/mcp-config/env-vars.md#pending_deletion_max_age_days),
     default 30 days) is rejected before anything is fetched — see
     [Batch expiry](#batch-expiry). It then re-checks staleness: an item used within `minAgeDays`, or
     accessed on or after the batch date, is rejected. If Admin Insights cannot confirm staleness,
     the delete fails closed.
   - For `extract-refresh-task`: verifies the `confirmationToken` matches the nonce from the
     preview.
   - Performs the deletion.

:::warning[Human confirmation required]
Between the preview and the confirm, the calling agent is instructed to surface the resource
identity to the user and obtain explicit approval. This is a prompt-level expectation; the
tag/nonce gate proves a preview ran but cannot observe whether a human actually approved.

When the `mcp-apps` feature flag is enabled **and the client can render the in-iframe confirm
panel**, the model-driven `confirm: true` path is **closed** entirely — deletion requires a human
gesture in that panel. A flag-on client that cannot render the panel (registered as a plain tool)
falls back to the readable text preview flow described above, so it never receives an unrenderable
app-card payload.
:::

## Batch expiry

A cleanup batch can be confirmed only while it is at most `PENDING_DELETION_MAX_AGE_DAYS` days old
(default 30, range 1–90; a batch opened today is 0 days old). A confirm naming an older
`cleanupDate` fails with `cleanup-batch-expired` and nothing is deleted.

This bounds how long a marker left behind by a crashed session or an abandoned preview can still
authorize a delete, without relying on anyone cleaning it up. Expiry does **not** remove the marker:
it stays on the item (and in the Tableau UI) until cleared with
`action: "remove-pending-tags"` (see [Pending-deletion markers](#pending-deletion-markers)). To delete an item from an expired
batch, run a new preview (which opens today's batch) and confirm that one.

The limit is a server setting only; it cannot be raised per site or per request.

## Tool scoping

This tool honors the same [tool-scoping](../../configuration/mcp-config/tool-scoping.md) rules as
the read tools. If the server is configured with a bounded context (`INCLUDE_WORKBOOK_IDS`,
`INCLUDE_PROJECT_IDS`, `INCLUDE_DATASOURCE_IDS`, `INCLUDE_TAGS`), a resource outside that scope
cannot be previewed or deleted — the request is rejected before any side effects.

## APIs called

### Workbook

- [Add Tags to Workbook](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#add_tags_to_workbook) (preview)
- [Query Workbook](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbook) (preview + confirm verification)
- Admin Insights Site Content via [VizQL Data Service](https://help.tableau.com/current/api/vizql-data-service/en-us/index.html) (preview + confirm staleness re-check)
- [Delete Workbook](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#delete_workbook) (confirm)

### Datasource

- [Add Tags to Data Source](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#add_tags_to_data_source) (preview)
- [Query Data Source](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_source) (preview + confirm verification)
- Admin Insights Site Content via [VizQL Data Service](https://help.tableau.com/current/api/vizql-data-service/en-us/index.html) (preview + confirm staleness re-check)
- [Delete Data Source](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#delete_data_source) (confirm)
- [Metadata API — lineage query](https://help.tableau.com/current/api/metadata_api/en-us/index.html) (preview — downstream-dependent warning)

### Extract Refresh Task

- [List Extract Refresh Tasks](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_jobs_tasks_and_schedules.htm#list_extract_refresh_tasks) (preview + confirm — existence check, since there is no single-get endpoint)
- [Delete Extract Refresh Task](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_extract_and_encryption.htm#delete_extract_refresh_task) (confirm)

### Common

- [Get User on Site (REST)](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#get_user_on_site) — admin gate

## Pending-deletion markers

A workbook or data source preview tags the item `pending-deletion-YYYY-MM-DD` (UTC). If the user
declines, or an item should be kept, clear the marker with `action: "remove-pending-tags"` — the
in-app confirm panel's **Cancel** does this automatically.

- Removes only labels that parse as a pending-deletion marker (`pending-deletion-YYYY-MM-DD` and the
  legacy undated `pending-deletion`); `pending-deletion-notes`, `finance`, etc. are left alone.
- **Never deletes content.** It accepts only `resourceType` (`workbook` or `datasource`),
  `resourceIds` (1–100 LUIDs, duplicates ignored) and optionally `cleanupDate`. `confirm`,
  `resourceId`, `minAgeDays`, `confirmationToken` and `extract-refresh-task` are rejected rather than
  ignored. It runs immediately — no preview/confirm, no human-confirmation panel — because it is
  reversible and writes only tags.
- With `cleanupDate`, removes only that batch's marker; otherwise every marker on each item.
- Results are per item: `status` is `removed`, `no-markers` (idempotent, no write), `not-allowed`
  (outside [tool scoping](../../configuration/mcp-config/tool-scoping.md); not read or written) or
  `error` (with `message`; the rest of the batch continues). Each item emits an `update` audit record.
- Also clears markers from expired batches: a batch older than [`PENDING_DELETION_MAX_AGE_DAYS`](#batch-expiry)
  stops authorizing deletes, but its marker stays until removed here.
- To **find** markers, use the read-only `list-workbooks` / `list-datasources` with
  `filter: "tags:eq:pending-deletion-2026-09-25"` (or `tags:in:[...]`).

```json
{
  "action": "remove-pending-tags",
  "resourceType": "workbook",
  "resourceIds": ["222ea993-9391-4910-a167-56b3d19b4e3b"],
  "cleanupDate": "2026-09-25"
}
```

```json
{
  "removedCount": 1,
  "items": [
    {
      "resourceId": "222ea993-9391-4910-a167-56b3d19b4e3b",
      "status": "removed",
      "removedTags": ["pending-deletion-2026-09-25"]
    }
  ]
}
```

## Required arguments

### `action`

`"delete"` (default) runs the two-phase delete above. `"remove-pending-tags"` clears pending-deletion
markers (see [Pending-deletion markers](#pending-deletion-markers)).

<hr />

### `resourceType`

The kind of resource to delete: `"workbook"`, `"datasource"`, or `"extract-refresh-task"`.

### `resourceIds`

**For `action="remove-pending-tags"` only.** LUIDs of the workbooks or data sources to clear (1–100).
Rejected for `action="delete"`.

<hr />

### `resourceId`

**For `action="delete"`.** The LUID of the workbook or data source, or the UUID of the extract refresh task.

Example: `"222ea993-9391-4910-a167-56b3d19b4e3b"`

## Optional arguments

### `confirm`

When omitted or `false`, runs the non-destructive preview. When `true`, permanently deletes —
but only if the prior-preview evidence is present (the batch tag for workbook/datasource,
`confirmationToken` for extract-refresh-task).

Example: `true`

<hr />

### `cleanupDate`

**For `resourceType="workbook"` or `"datasource"` only.** The cleanup batch date (`YYYY-MM-DD`,
UTC) reported by the preview. A preview always stamps today's UTC date — passing any other date
on a preview is rejected. On confirm it defaults to today; pass the preview's date when confirming
on a later day. Future dates are rejected, and so are batches older than
[`PENDING_DELETION_MAX_AGE_DAYS`](#batch-expiry) (default 30 days).

Example: `"2026-09-25"`

<hr />

### `minAgeDays`

**For `resourceType="workbook"` or `"datasource"` only.** Minimum days since last access for the
item to still count as stale (1–3650). Defaults to the server stale-content threshold
(`STALE_CONTENT_MIN_AGE_DAYS`, default 90). Use the same value on preview and confirm.

Example: `120`

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

- **Preview (workbook/datasource)** adds the `pending-deletion-YYYY-MM-DD` batch tag. Reversible —
  find markers with `list-workbooks` / `list-datasources` (`tags:eq` filter) and clear them with
  `action: "remove-pending-tags"`.
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
  "confirm": true,
  "cleanupDate": "2026-09-25"
}
```

## Related

- [`query-admin-insights`](../admin-insights/query-admin-insights.md) — admin-insights query tool
- [`list-workbooks`](../workbooks/list-workbooks.md) / [`list-datasources`](../data-qna/list-datasources.md) — find pending-deletion markers with a `tags:eq` filter
