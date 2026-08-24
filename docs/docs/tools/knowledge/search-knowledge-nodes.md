---
sidebar_position: 3
---

# Search Knowledge Nodes

Semantically searches nodes in a Tableau knowledge graph and returns ranked matches.

Omit `graphId` to search the site's default graph, or supply one from Tableau Knowledge configuration or a prior workflow; this tool
does not discover graphs. The tool requires Tableau Knowledge on Tableau Cloud.

## Arguments

| Parameter  | Type             | Required | Description                                                  |
| ---------- | ---------------- | -------- | ------------------------------------------------------------ |
| `graphId` | string | No | Knowledge graph ID. Omit to target the site's active (default) graph. |
| `query`    | non-empty string | Yes      | Natural-language description of nodes to find.               |
| `nodeType` | string           | No       | Restrict matches to one knowledge node type.                 |
| `scopeId`  | string           | No       | Restrict matches to one source/container subtree.            |
| `limit`    | integer, 1–100   | No       | Ranked-match limit (default 24); configuration can lower it. |

`limit` bounds the ranked matches returned by the backend.

The tool is read-only and requires `tableau:mcp:knowledge:read` and `tableau:knowledge:read`.
