---
sidebar_position: 2
---

# Stale Content Cleanup — Apply

`stale-content-cleanup-apply`

A guided, **destructive** Tableau Cloud admin workflow that identifies stale workbooks and published data sources, tags them for deletion, reports their owners to notify, and — only after explicit human approval — deletes the approved items to the recycle bin.

:::warning[Admin Only · Destructive]
This prompt is restricted to Tableau site administrators and requires the `ADMIN_TOOLS_ENABLED` feature flag. It drives destructive delete tools. A human-in-the-loop confirmation break between tagging and deletion is **required** and built into the workflow.
:::

## Workflow

The prompt sequences existing deterministic tools — it performs no calculations itself:

1. **Report** — calls [`get-stale-content-report`](../tools/admin-insights/get-stale-content-report.md) once; uses its rows verbatim.
2. **Resolve LUIDs** — the report emits a numeric `itemId`, not the LUID the delete tools need. Each item's LUID is resolved via `list-workbooks` / `list-datasources` filtered by name and project. Ambiguous matches are skipped, never guessed.
3. **Tag (reversible preview)** — calls the matching delete tool ([`delete-workbook`](../tools/workbooks/delete-workbook.md) / [`delete-datasource`](../tools/data-qna/delete-datasource.md)) in preview mode to tag each item `pending-deletion` and obtain a per-item `confirmationToken`. Nothing is deleted.
4. **Notify report** — builds an owner-notification table using the report's `ownerEmail`, falling back to [`list-users`](../tools/users/list-users.md) filtered by owner LUID (`id:in:...`) for any gaps. Report-only; no email is sent.
5. **Human confirmation break** — presents the tagged items and owners and requires explicit approval before any deletion.
6. **Grace check** — confirms the notification window has elapsed and the items are still the intended targets.
7. **Delete (confirmed)** — only for approved items, calls the delete tool with `confirm: true` and the exact `confirmationToken` from step 3. Deleted content goes to the Tableau recycle bin (recoverable for a limited time).

## Arguments

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `minAgeDays` | string (integer) | No | Minimum days since last access for content to be considered stale. Defaults to the server-configured threshold (default 90). |
| `projectIds` | string | No | Comma-separated project LUIDs to scope the cleanup to. |
| `itemTypes` | string | No | Comma-separated subset of content types to clean up (`Workbook`, `Datasource`). Defaults to all supported types. |
| `tag` | string | No | Pending-deletion label applied during the tag phase. Defaults to `pending-deletion`. |
| `dryRun` | `"true"` \| `"false"` | No | When `true` (default), stops after tag + notify and never deletes — a safe rehearsal. Set to `false` to allow the confirmed-delete phase after approval. |

## Extensibility

The prompt is parameterized over a content-type registry mapping each `itemType` to its list and delete tools. Supporting a new content type is a matter of adding a registry entry plus its delete tool — the workflow text adapts automatically.

## Configuration

```bash
ADMIN_TOOLS_ENABLED=true
```

See also: [Environment Variables](../configuration/mcp-config/env-vars.md)
