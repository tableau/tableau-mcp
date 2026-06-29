---
sidebar_position: 3
---

# Job Optimization — Inform

`job-optimization-inform`

A read-only Tableau Cloud admin workflow that analyzes Admin Insights job performance and surfaces optimization signals.

:::warning[Admin Only]
This prompt is restricted to Tableau site administrators and requires the `ADMIN_TOOLS_ENABLED` site setting.
:::

## Workflow

The prompt instructs the model to call [`query-admin-insights-job-performance`](../tools/admin-insights/query-admin-insights-job-performance.md) and render the returned rows as a Markdown table followed by an "Optimization signals" section. Defaults to extract-refresh job types; set `discover` to first enumerate every Job Type on the site and analyze each. Read-only — no schedule, pause, or delete actions.

## Arguments

| Argument | Type | Required | Description |
|----------|------|----------|-------------|
| `jobType` | string | No | Comma-separated raw Job Type values to analyze. Defaults to the extract-refresh types. Ignored when `discover` is `true`. |
| `lookbackDays` | string (integer) | No | Window on `Started At`, in days. Tableau Cloud caps lookback at 90 (365 with Advanced Management). |
| `limit` | string (integer) | No | Maximum rows per job-type query. |
| `discover` | `"true"` \| `"false"` | No | When `true`, first discover the Job Type values on the site, then analyze each. |

## Configuration

```bash
ADMIN_TOOLS_ENABLED=true
```

See also: [Environment Variables](../configuration/mcp-config/env-vars.md)
