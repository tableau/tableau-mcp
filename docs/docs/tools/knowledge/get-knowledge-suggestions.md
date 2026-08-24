---
sidebar_position: 1
---

# Get Knowledge Suggestions

Returns the full health report and improvement suggestions for a Tableau knowledge graph.

:::info[Tableau Cloud Only]

This tool requires Tableau Knowledge to be available for the site. Supply a graph ID from Tableau
Knowledge configuration or a prior workflow; the tool does not discover graphs.

:::

## Arguments

| Parameter  | Type                       | Required | Description                                               |
| ---------- | -------------------------- | -------- | --------------------------------------------------------- |
| `graphId` | string | No | Knowledge graph ID. Omit to target the site's active (default) graph. |
| `pdsId`    | string                     | No       | Scope the report to one PDS subtree.                      |
| `severity` | `high`, `medium`, or `low` | No       | Filter suggestion lists by severity.                      |
| `type`     | string                     | No       | Filter suggestion lists by suggestion type.               |
| `limit`    | positive integer           | No       | Truncate the top suggestions (default 100, maximum 1000). |

The tool is read-only and requires the `tableau:mcp:knowledge:read` MCP scope and
`tableau:knowledge:read` Tableau API scope. An empty `suggestions` array is a successful health
report.

The configured `MAX_RESULT_LIMIT` or `MAX_RESULT_LIMITS` value can further restrict `limit`. The
health score, statistics, metrics, and summary still describe the full graph when suggestion lists
are truncated.
