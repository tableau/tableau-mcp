---
sidebar_position: 10
---

# Update Semantic Statements

Directly replaces statements or changes a semantic context's metadata or attachment.

:::warning[Destructive Private Prototype]

Replacing `statements` or attachments discards the prior values. This tool has no preview or
confirmation step. The `knowledge-write-tools` feature flag must be enabled.

:::

## Arguments

| Parameter      | Type             | Required | Description                                                          |
| -------------- | ---------------- | -------- | -------------------------------------------------------------------- |
| `graphId`      | string           | Yes      | Knowledge graph ID from configuration or a prior workflow.           |
| `contextId`    | string           | Yes      | Semantic context ID returned by create or list.                      |
| `statements`   | array            | No       | Non-empty replacement array of trimmed, 5–1000 character statements. |
| `targetNodeId` | string or `null` | No       | Replace the attached node, or explicitly detach with `null`.         |
| `isGlobal`     | boolean          | No       | Change between attached and graph-wide state.                        |
| `name`         | string           | No       | Replacement display name; blank resets the generated label.          |

At least one update field is required. To move attached statements to graph-wide, send
`isGlobal: true` and explicit `targetNodeId: null`. To move graph-wide statements to a node, send
`isGlobal: false` and a non-null `targetNodeId`. A non-null `targetNodeId` alone replaces the
current attachment. Single-field partial transitions are forwarded because the backend validates
them against the context's current state; contradictory supplied pairs are rejected locally.

The tool requires `tableau:mcp:knowledge:write` and `tableau:knowledge:write`.
