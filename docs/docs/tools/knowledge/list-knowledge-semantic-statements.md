---
sidebar_position: 9
---

# List Semantic Statements

Lists semantic statements from a Tableau Knowledge graph.

## Arguments

| Parameter  | Type    | Required | Description                                                         |
| ---------- | ------- | -------- | ------------------------------------------------------------------- |
| `graphId` | string | No | Knowledge graph ID from configuration or a prior workflow. Omit to target the site's active (default) graph. |
| `nodeId`   | string  | No       | Return statements attached to this node plus all global statements. |
| `isGlobal` | boolean | No       | Filter a graph-wide list. Cannot be combined with `nodeId`.         |

The backend currently ignores its `query`, `kind`, and `limit` search fields, so this tool does not
expose them. Results are capped at 100 or the configured MCP result limit. The response includes
`mcp.resultInfo` with `returnedCount`, `totalAvailable`, and `truncated` so callers can detect an
incomplete list.

The tool is read-only and requires `tableau:mcp:knowledge:read` and `tableau:knowledge:read`.
