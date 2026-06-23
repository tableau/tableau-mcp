---
sidebar_position: 4
---

# Extract Refresh Optimization — Apply

`extract-optimization-apply`

A guided, **destructive** Tableau Cloud admin workflow that joins the extract refresh inventory with Admin Insights job performance, recommends a `keep` / `downgrade` / `delete` action per task, and — only after explicit human approval — applies those changes.

:::warning[Admin Only · Destructive]
This prompt is restricted to Tableau site administrators and requires the `ADMIN_TOOLS_ENABLED` feature flag. It drives the destructive [`update-cloud-extract-refresh-task`](../tools/tasks/update-cloud-extract-refresh-task.md) and [`delete-extract-refresh-task`](../tools/tasks/delete-extract-refresh-task.md) tools. The inventory, performance, and recommendation steps are **read-only**: no task is updated or deleted until the user approves a specific task set at the required human-in-the-loop confirmation break.
:::

## Workflow

The prompt sequences existing deterministic tools — it performs no calculations itself. Steps 1–3 are read-only; no write happens until after the Step 4 approval break:

1. **Inventory (read-only)** — calls [`list-extract-refresh-tasks`](../tools/tasks/list-extract-refresh-tasks.md) once to enumerate every extract refresh task on the site. When `taskIds` is supplied, the working set is narrowed client-side; any requested ID missing from the inventory is reported under "Missing tasks" and skipped.
2. **Performance signals (read-only)** — calls [`query-admin-insights-job-performance`](../tools/admin-insights/query-admin-insights-job-performance.md) once with a pre-baked filter on the four extract-refresh job types (`RefreshExtracts`, `IncrementExtracts`, `RefreshExtractsViaBridge`, `IncrementExtractsViaBridge`). Rows are used verbatim — no recomputation.
3. **Recommend (read-only)** — joins inventory (step 1) and performance rows (step 2) per task and produces a Markdown table with a `keep` / `downgrade` / `delete` recommendation per row. `delete` is only proposed when the task has zero successful runs in the lookback window AND a non-zero failure count, or is otherwise demonstrably abandoned.
4. **Human confirmation break** — presents the recommendation table and requires explicit approval (`yes` or a list of Task IDs) before any update or delete. A previous approval does not carry forward. In a dry run (the default) the workflow stops here, having written nothing.
5. **Apply (only after Step 4 approval)** — for each approved task, in order: `downgrade` rows call [`update-cloud-extract-refresh-task`](../tools/tasks/update-cloud-extract-refresh-task.md) with the proposed schedule; `delete` rows call [`delete-extract-refresh-task`](../tools/tasks/delete-extract-refresh-task.md) (**irreversible**). Calls are sequential, not parallel; the first error stops the run.
6. **Final report** — prints a "Changes applied" section listing every task touched and the outcome, a "Skipped" section for `keep` rows or operator-excluded rows, and (when `taskIds` was supplied) a "Missing tasks" section.

## Arguments

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `lookbackDays` | string (integer) | No | Window on `Started At` for the performance read, in days. Tableau Cloud caps lookback at 90 (365 with Advanced Management). |
| `taskIds` | string | No | Comma-separated extract refresh task IDs (letters, numbers, commas, spaces, dashes). When omitted, every task returned by the inventory is analyzed. |
| `dryRun` | `"true"` \| `"false"` | No | When `true` (default), produces only the recommendation report — never calls the update or delete tools. Set to `false` to allow the apply step after the confirmation break. |

## Safety guarantees

- No task is updated or deleted until the user approves a specific task set at the Step 4 break.
- The workflow only acts on tasks the user explicitly approved; tasks the user did not approve are never touched.
- `delete-extract-refresh-task` is irreversible; `update-cloud-extract-refresh-task` is reversible by re-applying the prior schedule.
- Apply calls run sequentially, not in parallel; the first error stops the run so the operator can review partial state.

## Configuration

```bash
ADMIN_TOOLS_ENABLED=true
```

See also: [Environment Variables](../configuration/mcp-config/env-vars.md)
