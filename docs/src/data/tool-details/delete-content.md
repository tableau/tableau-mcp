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
