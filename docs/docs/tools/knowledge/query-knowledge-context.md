---
sidebar_position: 1
---

# Query Knowledge Context

Queries governed definitions, relationships, lineage, impact, and source inventory from Tableau
Knowledge. This read-only tool is available on Tableau+ sites.

:::warning[Disabled by Default]
This tool requires the `knowledge-tools` feature flag, which defaults to `false` in `features.json`.
See [Feature Flags](../../developers/feature-flags.md).
:::

## Intents

| `intent`        | Result                                                           | Tableau Knowledge operations                           |
| --------------- | ---------------------------------------------------------------- | ------------------------------------------------------ |
| `ground`        | Entity identity plus attached and graph-wide semantic statements | Node, node semantic contexts, global semantic contexts |
| `relationships` | Incoming or outgoing edges around a node                         | Edge search                                            |
| `lineage`       | Lineage nodes and edges                                          | Node lineage                                           |
| `impact`        | Assets affected by a node                                        | Node impact                                            |
| `sources`       | Published data sources and workbooks represented in the graph    | Source search                                          |

For any node-based intent, pass either `query` or `nodeId`. A natural-language `query` returns
ranked candidates and `requiresNodeId: true`; it never silently chooses a node. Select a candidate
and call the same intent again with its exact `nodeId`.

```json title="Resolve an entity"
{
  "intent": "ground",
  "query": "What is AOV for Sales Cloud?"
}
```

```json title="Ground the selected entity"
{
  "intent": "ground",
  "nodeId": "pds-1",
  "query": "AOV"
}
```

## Visibility labels

Each returned semantic statement has a `viewGated` field:

- `true`: visibility follows the VIEW permission of a Tableau-managed source.
- `false`: the statement is customer-authored graph context governed by site access rather than a
  per-source VIEW check.

`viewGated` describes the authorization model. It is not a quality or trust score. Customer-authored
context should be described as customer-governed, not as universally trusted.

An empty attached-context response has `status: "unknown"`. Tableau Knowledge may have filtered
content the caller cannot view, so clients must not report that the node has no attached context.
Check `groundingStatus`, `mcp.warnings`, and `resultInfo` before making completeness claims.

## Limits

`limit` defaults to 25 and is capped at 100. For grounding, it limits flattened statements rather
than context containers. For traversal intents it limits each returned node, edge, asset, or source
array. [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit) and
`MAX_RESULT_LIMITS=query-knowledge-context:N` can lower the limit.

## Scopes

- MCP: `tableau:mcp:knowledge:read`
- Tableau API: `tableau:knowledge:read`

The tool is omitted from sessions where Tableau Knowledge is unavailable. It can also be excluded
with [`EXCLUDE_TOOLS`](../../configuration/mcp-config/env-vars.md#exclude_tools), including through
the `knowledge` tool group.
