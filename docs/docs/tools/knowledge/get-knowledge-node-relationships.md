---
sidebar_position: 5
---

# Get Knowledge Node Relationships

Returns relationships around one node in a Tableau Knowledge graph. Anchor the request
with at least one of an exact `nodeId` or a natural-language `query`. When both are supplied,
`nodeId` takes precedence and `query` acts as fallback context.

## Arguments

| Parameter   | Type                    | Required    | Description                                            |
| ----------- | ----------------------- | ----------- | ------------------------------------------------------ |
| `graphId` | string | No | Knowledge graph ID. Omit to target the site's active (default) graph. |
| `nodeId`    | non-empty string        | Conditional | Exact anchor node ID. At least one anchor is required. |
| `query`     | non-empty string        | Conditional | Natural-language query used to resolve an anchor.      |
| `edgeType`  | string                  | No          | Restrict results to one relationship type.             |
| `direction` | `outgoing` / `incoming` | No          | Restrict results relative to the anchor.               |
| `limit`     | integer, 1–100          | No          | Maximum relationships returned to the model.           |

The response includes `mcp.resultInfo` with truncation and returned/original counts. The tool is
read-only and requires `tableau:mcp:knowledge:read` and `tableau:knowledge:read`.
