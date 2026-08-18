---
sidebar_position: 7
---

# Get Knowledge Node Impact

Returns assets transitively affected by a change to one node. A missing node is reported as a normal
backend error.

## Arguments

| Parameter | Type             | Required | Description         |
| --------- | ---------------- | -------- | ------------------- |
| `graphId` | string           | Yes      | Knowledge graph ID. |
| `nodeId`  | non-empty string | Yes      | Exact node ID.      |

The tool returns at most 100 affected assets, further constrained by configured result limits, and
includes returned/original counts in `mcp.resultInfo`. It is read-only and requires
`tableau:mcp:knowledge:read` and `tableau:knowledge:read`.
