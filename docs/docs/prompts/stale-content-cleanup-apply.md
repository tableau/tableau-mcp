---
sidebar_position: 2
---

# Stale Content Cleanup — Apply

`stale-content-cleanup-apply`

A guided, **destructive** Tableau Cloud admin workflow that identifies stale workbooks and published data sources, reports their owners to notify, and — only after explicit human approval — tags the approved items and deletes them to the recycle bin.

:::warning[Admin Only · Destructive]
This prompt is restricted to Tableau site administrators and requires the `ADMIN_TOOLS_ENABLED` environment variable. It drives destructive delete tools. The report, LUID-resolution, and notify steps are **read-only**: no content is written (tagged or deleted) until the user approves a specific item set at the required human-in-the-loop confirmation break.
:::

## Workflow

The prompt sequences existing deterministic tools — it performs no calculations itself. Steps 1–3 are read-only; no write happens until after the Step 4 approval break:

1. **Report (read-only)** — calls [`query-admin-insights`](../tools/admin-insights/query-admin-insights.md) with `kind: "stale-content"` once; uses its rows verbatim. If the report returns more than 100 rows, the workflow refuses to act on the whole batch and asks the user to narrow scope first.
2. **Resolve LUIDs (read-only)** — the report emits a numeric `itemId`, not the LUID the delete tools need. Each item's LUID is resolved via `list-workbooks` / `list-datasources` filtered by name and project. Ambiguous matches are skipped, never guessed.
3. **Notify report (read-only)** — builds an owner-notification table using the report's `ownerEmail`, falling back to [`list-users`](../tools/users/list-users.md) filtered by owner LUID (`id:in:...`) for any gaps. Report-only; no email is sent.
4. **Human confirmation break** — presents the resolved items and owners and requires explicit approval before any tag or delete. In a dry run (the default) the workflow stops here, having written nothing.
5. **Tag approved items (reversible)** — only for approved items, calls [`delete-content`](../tools/content/delete-content.md) in preview mode (with the appropriate `resourceType` and `minAgeDays`). The server re-checks that each item is still stale and tags it with the date-stamped batch marker `pending-deletion-YYYY-MM-DD` (UTC); the workflow records the `cleanupDate` each preview reports. Items whose preview is rejected (no longer stale, or staleness unverified) are dropped. Nothing is deleted.
6. **Grace check** — confirms the notification window has elapsed and the items are still the intended targets. Items the owner asked to keep are un-marked with [`delete-content`](../tools/content/delete-content.md#pending-deletion-markers) (`action: "remove-pending-tags"`). Keep the grace window shorter than the server's batch age limit ([`PENDING_DELETION_MAX_AGE_DAYS`](../configuration/mcp-config/env-vars.md#pending_deletion_max_age_days), default 30 days) — a batch older than that can no longer be confirmed and must be re-previewed.
7. **Delete (confirmed)** — only for approved items, calls the delete tool with `confirm: true`, the recorded `cleanupDate`, and the same `minAgeDays`. The tool re-fetches each item, deletes only if it carries that batch's marker, and re-checks staleness first — an untagged item, an item tagged for a different batch, an item used since the batch, or a batch older than the age limit is rejected server-side and not retried. Deleted content goes to the Tableau recycle bin (recoverable for a limited time).
8. **Clear residue** — lists the batch's tagged items with `list-workbooks` / `list-datasources` (`tags:eq:pending-deletion-<cleanupDate>`) and removes any markers left on items that were not deleted with [`delete-content`](../tools/content/delete-content.md#pending-deletion-markers) (`action: "remove-pending-tags"`).

A pending-deletion tag authorizes only its own cleanup batch, only until the batch is older than the age limit, and every delete re-checks staleness — an old or legacy tag can never silently authorize a deletion.

## Arguments

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `minAgeDays` | string (integer) | No | Minimum days since last access for content to be considered stale. Defaults to the server-configured threshold (default 90). |
| `projectIds` | string | No | Comma-separated project LUIDs to scope the cleanup to. |
| `itemTypes` | string | No | Comma-separated subset of content types to clean up (`Workbook`, `Datasource`). Defaults to all supported types. |
| `dryRun` | `"true"` \| `"false"` | No | When `true` (default), stops at the confirmation break after the read-only report and notify steps — writing nothing (no tag, no delete). A safe rehearsal. Set to `false` to allow tagging and the confirmed-delete phase after approval. |

## Extensibility

The prompt is parameterized over a content-type registry mapping each `itemType` to its list and delete tools. Supporting a new content type is a matter of adding a registry entry plus its delete tool — the workflow text adapts automatically.

## Configuration

```bash
ADMIN_TOOLS_ENABLED=true

# Optional overrides (env vars)
STALE_CONTENT_MIN_AGE_DAYS=90   # 1-3650; default 90
STALE_CONTENT_MAX_ROWS=100      # 1-10000; default 100
```

See also: [Environment Variables](../configuration/mcp-config/env-vars.md)
