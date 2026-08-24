---
sidebar_position: 6
---

# Get Knowledge Lineage

Returns dependency and lineage nodes and edges for one exact node in a Tableau Knowledge
graph. A missing node is a successful empty result.

## Arguments

| Parameter | Type             | Required | Description         |
| --------- | ---------------- | -------- | ------------------- |
| `graphId` | string | No | Knowledge graph ID. Omit to target the site's active (default) graph. |
| `nodeId`  | non-empty string | Yes      | Exact node ID.      |

The tool returns at most 100 nodes and 100 edges, further constrained by configured result limits,
and includes returned/original counts in `mcp.resultInfo`. It is read-only and requires
`tableau:mcp:knowledge:read` and `tableau:knowledge:read`.
