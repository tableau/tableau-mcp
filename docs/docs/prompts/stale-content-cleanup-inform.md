---
sidebar_position: 1
---

# Stale Content Cleanup — Inform

`stale-content-cleanup-inform`

A read-only Tableau Cloud admin workflow that identifies stale workbooks and published data sources and renders them as a report for review.

:::warning[Admin Only]
This prompt is restricted to Tableau site administrators and requires the `ADMIN_TOOLS_ENABLED` site setting.
:::

## Workflow

The prompt instructs the model to call [`query-admin-insights`](../tools/admin-insights/query-admin-insights.md) with `kind: "stale-content"` exactly once — which performs the TS Events / Site Content anti-join and applies the staleness threshold server-side — and render the already-filtered rows as a Markdown table. No client-side math; no tagging, notification, or deletion. Pair with [stale-content-cleanup-apply](stale-content-cleanup-apply.md) to act on the results.

## Arguments

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `minAgeDays` | string (integer) | No | Minimum days since last access for content to be considered stale. Defaults to the server-configured threshold (default 90). |
| `projectIds` | string | No | Comma-separated project LUIDs to scope the report to. |

## Configuration

```bash
ADMIN_TOOLS_ENABLED=true
```

See also: [Environment Variables](../configuration/mcp-config/env-vars.md)
