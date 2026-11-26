---
sidebar_position: 1
---

# Delete Tableau Content

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Permanently deletes a workbook, published data source, or extract refresh task. This is a **destructive** two-phase mutation: a preview call (`confirm` omitted or `false`) reports the proposed deletion and records prior-preview evidence, and a second confirm call (`confirm: true`) performs the deletion only after that evidence is verified. Dispatches on `resourceType`:

- `workbook` — deletes a workbook (recoverable from the Tableau Cloud [recycle bin](https://help.tableau.com/current/pro/desktop/en-us/recycle_bin.htm) for a limited time)
- `datasource` — deletes a published data source (recoverable from the Tableau Cloud [recycle bin](https://help.tableau.com/current/pro/desktop/en-us/recycle_bin.htm); the preview warns about downstream dependents)
- `extract-refresh-task` — deletes an extract refresh task schedule (Tableau Cloud only; permanent, not recoverable)

:::warning[Admin Only]
Registered only when [`ADMIN_TOOLS_ENABLED`](../../configuration/mcp-config/env-vars.md#admin_tools_enabled)`=true`. At request time it verifies the caller's site role and rejects anything below `SiteAdministratorCreator` / `SiteAdministratorExplorer` / `ServerAdministrator`.
:::

## APIs called

This tool talks to the **Tableau REST API** (Tableau Cloud or Server) for the read, tag, and delete operations, and to the **Metadata API** (GraphQL) for the data-source dependency check. Because the mutation is two-phase, a preview call only reads (and, for a workbook or data source, tags) the target, while the delete is issued only on a confirmed call — so a preview-phase read needs a read scope, and the confirm-phase delete needs a delete scope. Every request is admin-gated (see the gating admonition above). The MCP-layer OAuth scope for this tool is `tableau:mcp:content:delete`; the union of Tableau API scopes across the resource types is `tableau:content:read`, `tableau:workbook_tags:update`, `tableau:workbooks:delete`, `tableau:datasource_tags:update`, `tableau:datasources:delete`, `tableau:tasks:read`, `tableau:tasks:delete`, `tableau:users:read`, plus `tableau:mcp_site_settings:read` to read per-site MCP configuration overrides when MCP site settings are enabled.

- **Enforce the admin gate and resolve owner identity.** Reads a user record to verify the caller's site role before any side effect, and to resolve the target's owner email for the response and audit record.
  - `GET /api/{version}/sites/{siteId}/users/{userId}` — read the user record for the admin gate and owner resolution. Issued against the Tableau REST API; requires the `tableau:users:read` OAuth scope. [Query User on Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_users_and_groups.htm#query_user_on_site)
- **Tag the target for pending deletion** (`workbook` / `datasource` preview). Applies the reversible, UI-visible pending-deletion tag as prior-preview evidence.
  - `PUT /api/{version}/sites/{siteId}/workbooks/{workbookId}/tags` — tag a workbook. Issued against the Tableau REST API; requires the `tableau:workbook_tags:update` OAuth scope. [Add Tags to Workbook](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#add_tags_to_workbook)
  - `PUT /api/{version}/sites/{siteId}/datasources/{datasourceId}/tags` — tag a data source. Issued against the Tableau REST API; requires the `tableau:datasource_tags:update` OAuth scope. [Add Tags to Data Source](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#add_tags_to_data_source)
- **Read the target to report identity and re-verify evidence** (`workbook` / `datasource`, both phases). Reads name, project, and owner during preview, and re-checks that the pending-deletion tag is present during confirm.
  - `GET /api/{version}/sites/{siteId}/workbooks/{workbookId}` — read a workbook. Issued against the Tableau REST API; requires the `tableau:content:read` OAuth scope. [Query Workbook](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbook)
  - `GET /api/{version}/sites/{siteId}/datasources/{datasourceId}` — read a data source. Issued against the Tableau REST API; requires the `tableau:content:read` OAuth scope. [Query Data Source](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_source)
- **Warn about downstream dependents** (`datasource` preview only). Best-effort lineage lookup for workbooks and flows that depend on the data source; degrades to a neutral note and never fails the preview when the Metadata API is disabled or errors.
  - `POST /api/metadata/graphql` — query the data source's downstream lineage. Issued against the Metadata API (GraphQL); requires the `tableau:content:read` OAuth scope. Skipped when [`DISABLE_METADATA_API_REQUESTS`](../../configuration/mcp-config/env-vars.md#disable_metadata_api_requests) is set. [Metadata API](https://help.tableau.com/current/api/metadata_api/en-us/index.html)
- **Verify the task exists** (`extract-refresh-task`, both phases). Lists the site's extract refresh tasks to confirm the id (there is no single-get endpoint) and to enrich the audit record with the underlying content's name, project, and owner; an unknown id returns a not-found error and no confirmation token is minted.
  - `GET /api/{version}/sites/{siteId}/tasks/extractRefreshes` — list extract refresh tasks. Issued against the Tableau REST API; requires the `tableau:tasks:read` OAuth scope. [List Extract Refresh Tasks](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_jobs_tasks_and_schedules.htm#list_extract_refresh_tasks)
- **Delete the resource** (confirm only). Issues the delete for the selected resource type after the mutation guard has verified the prior-preview evidence.
  - `DELETE /api/{version}/sites/{siteId}/workbooks/{workbookId}` — delete a workbook. Issued against the Tableau REST API; requires the `tableau:workbooks:delete` OAuth scope. [Delete Workbook](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#delete_workbook)
  - `DELETE /api/{version}/sites/{siteId}/datasources/{datasourceId}` — delete a data source. Issued against the Tableau REST API; requires the `tableau:datasources:delete` OAuth scope. [Delete Data Source](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#delete_data_source)
  - `DELETE /api/{version}/sites/{siteId}/tasks/extractRefreshes/{taskId}` — delete an extract refresh task. Issued against the Tableau REST API; requires the `tableau:tasks:delete` OAuth scope. [Delete Extract Refresh Task](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_extract_and_encryption.htm#delete_extract_refresh_task)

## Required arguments

### `resourceType`
The kind of resource to delete. One of `workbook`, `datasource`, or `extract-refresh-task`. Determines which branch runs and which prior-preview evidence the confirm phase requires (a pending-deletion tag for a workbook or data source, a `confirmationToken` for an extract refresh task).

#### Example

```json
{ "resourceType": "workbook" }
```

:::note
`action "remove-pending-tags"` supports `resourceType` `"workbook"` or `"datasource"` only; extract refresh tasks carry no tags.
:::

## Optional arguments

### `action`

"delete" (default): the preview → confirm deletion flow. "remove-pending-tags": remove pending-deletion marker tags from resourceIds; nothing is deleted.

:::note
`action "remove-pending-tags"` does not accept `resourceId`, `confirm`, `minAgeDays`, or `confirmationToken`. It only removes marker tags and never deletes content. The refusal names whichever of those arguments was passed.
:::

### `resourceId`
The LUID of the workbook or data source, or the UUID of the extract refresh task. For `extract-refresh-task` the value must be a valid UUID; this is validated before any Tableau REST session is opened.

#### Example

```json
{ "resourceId": "222ea993-9391-4910-a167-56b3d19b4e3b" }
```

### `resourceIds`

Only for action "remove-pending-tags": LUIDs of the workbooks or data sources to clear (1–100).

:::note
`action "delete" requires resourceId and does not accept resourceIds; use action "remove-pending-tags" to clear markers from several items.` `action "remove-pending-tags" requires resourceIds.`
:::

### `confirm`
When omitted or `false`, runs the non-destructive **preview**: it reports the target and records prior-preview evidence (tags a workbook or data source, or mints a short-lived `confirmationToken` bound to this change for an extract refresh task) without deleting anything. When `true`, permanently deletes — but only after the mutation guard verifies the prior-preview evidence (the pending-deletion tag for a workbook or data source, the `confirmationToken` for an extract refresh task).

#### Example

`true`

:::note[Human confirmation panel]
When the [`mcp-apps`](../../developers/feature-flags.md) feature flag is enabled, the model-driven `confirm: true` path is **closed** entirely: a `confirm: true` call is rejected, and the deletion is performed only when a person clicks the button in the in-iframe confirm panel.
:::

<hr />

### `cleanupDate`

Only for resourceType="workbook" or "datasource": the cleanup batch date (YYYY-MM-DD, UTC) returned by the preview. On confirm, defaults to today; pass it when confirming on a later day (batches older than the server limit, default 30 days, are rejected). A preview always uses today's date. With action "remove-pending-tags": remove only that batch's marker (default: every pending-deletion marker on each item, including the legacy undated tag).

:::note
On a workbook or data source preview, a `cleanupDate` other than today's UTC date is refused. Pass an earlier date only with `confirm: true`. The message is `cleanupDate must be today's UTC date (<today>) for a preview; pass an earlier cleanupDate only with confirm: true.`
:::

### `minAgeDays`

Only for resourceType="workbook" or "datasource": minimum days since last access for the item to still count as stale. Defaults to the server stale-content threshold (90).

### `confirmationToken`
**For `resourceType="extract-refresh-task"` only.** The short-lived token returned by a prior preview call. **Required when `confirm` is `true`;** ignored otherwise. This MCP server's mutation guard signs the token on preview, verifies its signature on confirm, and re-checks live Tableau state, so a forged or precomputed token, or a `confirm: true` call with no prior preview, is rejected. The token is not a Tableau REST API feature; it verifies on any replica that shares [`MUTATION_TOKEN_SECRET`](../../configuration/mcp-config/env-vars.md#mutation_token_secret).

#### Example

`"<token from preview>"`

:::note[The confirmation token is ephemeral]
A `confirmationToken` is valid for [`MUTATION_PREVIEW_TTL_MINUTES`](../../configuration/mcp-config/env-vars.md#mutation_preview_ttl_minutes) (default 5). If a confirm is rejected for a missing or expired token, re-run the preview to mint a fresh one.
:::

## Notes and caveats

- **Bounded-context tool scoping applies before any side effect.** This tool honors the same [tool-scoping](../../configuration/mcp-config/tool-scoping.md) rules as the read tools: when the server is configured with a bounded context ([`INCLUDE_WORKBOOK_IDS`](../../configuration/mcp-config/tool-scoping.md#include_workbook_ids), [`INCLUDE_PROJECT_IDS`](../../configuration/mcp-config/tool-scoping.md#include_project_ids), [`INCLUDE_DATASOURCE_IDS`](../../configuration/mcp-config/tool-scoping.md#include_datasource_ids), [`INCLUDE_TAGS`](../../configuration/mcp-config/tool-scoping.md#include_tags)), a resource outside that scope cannot be previewed or deleted — the request is rejected before any tag, token, or delete occurs.
- **Requires explicit human approval between the two phases.** After a preview, surface the resource identity (name, project, owner, and any dependents) to the user and obtain explicit approval before calling again with `confirm: true`. The tag/nonce gate proves a preview ran but cannot observe whether a human actually approved — do not auto-confirm.
- **Every attempt emits a durable-intent audit record.** Each mutation attempt — allowed, denied, completed, or failed — emits one structured-JSON audit record (actor, tool, action, phase, target identity, evidence kind, result) on a dedicated `audit` logger that bypasses the [`LOG_LEVEL`](../../configuration/mcp-config/env-vars.md#log_level) severity filter, so it cannot be suppressed by raising `LOG_LEVEL`. The server only writes these records to its log stream (stderr/stdout/file); retaining them in a durable, ideally immutable store (SIEM, log archive) is the deployment's responsibility — there is no built-in durable audit sink.

## Example results

### Preview a workbook deletion

Request:

```json
{
  "resourceType": "workbook",
  "resourceId": "222ea993-9391-4910-a167-56b3d19b4e3b"
}
```

Result:

```
Preview — workbook 'Regional Sales' (id 222ea993-9391-4910-a167-56b3d19b4e3b) in 'Finance', owner jane.doe@example.com. It has been tagged 'pending-deletion' (reversible). Once approved, call again with confirm: true. Deleted workbooks are recoverable from the Tableau recycle bin for a limited time.
```

### Confirm the workbook deletion

Request:

```json
{
  "resourceType": "workbook",
  "resourceId": "222ea993-9391-4910-a167-56b3d19b4e3b",
  "confirm": true
}
```

Result:

```
Deleted workbook 'Regional Sales' (id 222ea993-9391-4910-a167-56b3d19b4e3b) in 'Finance', owner jane.doe@example.com. It can be restored from the Tableau recycle bin for a limited time before permanent removal.
```

### Preview an extract refresh task deletion

Request:

```json
{
  "resourceType": "extract-refresh-task",
  "resourceId": "9f8e7d6c-5b4a-4321-8f0e-1a2b3c4d5e6f"
}
```

Result:

```
Preview — extract refresh task '9f8e7d6c-5b4a-4321-8f0e-1a2b3c4d5e6f' would be permanently deleted (the underlying data source or workbook is unaffected, but it will no longer be refreshed on this schedule). Once approved, call again with confirm: true and confirmationToken: "<token from preview>" before deleting.
```

## Related

- [`list-extract-refresh-tasks`](../tasks/list-extract-refresh-tasks.md) — look up the `resourceId` (task UUID) to delete an extract refresh task.
- [`query-admin-insights`](../admin-insights/query-admin-insights.md) — admin-insights query tool, including a stale-content report that surfaces deletion candidates.

{/* tool-details */}
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
     short-lived `confirmationToken` and reports task metadata.
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

the read tools. If the server is configured with a bounded context (`INCLUDE_WORKBOOK_IDS`,
cannot be previewed or deleted — the request is rejected before any side effects.

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

## Audit records and durability

Every mutation attempt — allowed, denied, completed, or failed — emits a single authoritative,
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

### Confirm the deletion

## Arguments no longer accepted

These arguments were described on an earlier page and are not accepted by the current tool.

### `tag`

**For `resourceType="workbook"` or `"datasource"` only.** The pending-deletion tag label applied during preview as reversible, UI-visible evidence that a preview ran; the confirm phase deletes only if this tag is present. May contain up to 200 characters of letters, numbers, spaces, underscores, and dashes. Defaults to `pending-deletion`.

#### Example

`"stale-pending-deletion"`

<hr />
{/* /tool-details */}
