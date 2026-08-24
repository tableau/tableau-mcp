---
sidebar_position: 8
---

# Create Semantic Statements

Creates a semantic context containing business rules for a Tableau Knowledge graph.

:::warning[Private Prototype]

This tool mutates the graph directly without a preview or confirmation step. Tableau Knowledge must
be available for the site, and the `knowledge-write-tools` feature flag must be enabled.

:::

## Arguments

| Parameter      | Type   | Required    | Description                                                                 |
| -------------- | ------ | ----------- | --------------------------------------------------------------------------- |
| `graphId` | string | No | Knowledge graph ID from configuration or a prior workflow. Omit to target the site's active (default) graph. |
| `statements`   | array  | Yes         | One or more statements. Each is trimmed and must contain 5–1000 characters. |
| `targetNodeId` | string | Conditional | Attach to exactly one node. Mutually exclusive with `isGlobal`.             |
| `isGlobal`     | `true` | Conditional | Apply graph-wide. Mutually exclusive with `targetNodeId`.                   |
| `name`         | string | No          | Optional display name.                                                      |

The tool requires `tableau:mcp:knowledge:write` and `tableau:knowledge:write`.
