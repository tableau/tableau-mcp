---
sidebar_position: 4
---

# Get Knowledge Node

Resolves a natural-language query to one full knowledge node with its match score. When a match is
ambiguous, the response instead contains sparse ranked candidates for disambiguation.

Omit `graphId` to resolve against the site's default graph, or supply one from Tableau Knowledge configuration or a prior workflow; this tool
does not discover graphs. The tool requires Tableau Knowledge on Tableau Cloud.

## Arguments

| Parameter       | Type             | Required | Description                                                |
| --------------- | ---------------- | -------- | ---------------------------------------------------------- |
| `graphId` | string | No | Knowledge graph ID. Omit to target the site's active (default) graph. |
| `query`         | non-empty string | Yes      | Natural-language description of the node to resolve.       |
| `nodeType`      | string           | No       | Restrict candidates to one knowledge node type.            |
| `scopeId`       | string           | No       | Restrict candidates to one source/container subtree.       |
| `maxCandidates` | integer, 1–25    | No       | Maximum candidates returned when disambiguation is needed. |

The tool is read-only and requires `tableau:mcp:knowledge:read` and `tableau:knowledge:read`.
