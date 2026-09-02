---
sidebar_position: 2
---

# List Knowledge Sources

Lists published data sources and workbooks in a Tableau knowledge graph. Use it to browse available
sources and obtain TK graph node IDs for later knowledge workflows.

:::info[Tableau Cloud Only]

This tool requires Tableau Knowledge to be available for the site. Supply a graph ID from Tableau
Knowledge configuration or a prior workflow; the tool does not discover graphs.

:::

## Arguments

| Parameter  | Type                | Required | Description                                         |
| ---------- | ------------------- | -------- | --------------------------------------------------- |
| `graphId`  | string              | Yes      | Knowledge graph ID.                                 |
| `nodeType` | `PDS` or `WORKBOOK` | No       | Filter the returned sources by knowledge node type. |
| `limit`    | integer, 1–100      | No       | Maximum sources returned.                           |

The response contains `sources` plus `mcp.resultInfo` completeness metadata. Results are capped at
100 and can be lowered by server configuration. Each source contains:

| Field            | Type                      | Description                                         |
| ---------------- | ------------------------- | --------------------------------------------------- |
| `id`             | string                    | TK graph node ID for other knowledge tools.         |
| `type`           | `PDS` or `WORKBOOK`       | Knowledge node type.                                |
| `name`           | string                    | Source name.                                        |
| `properties`     | object                    | Source-specific properties.                         |
| `last_synced_at` | string, `null`, or absent | Last synchronization timestamp when TK provides it. |

Additional backend metadata, such as a runtime synchronization status, is preserved when present but
is not guaranteed by the API contract.

The tool is read-only and requires the `tableau:mcp:knowledge:read` MCP scope and
`tableau:knowledge:read` Tableau API scope. An empty `sources` array is a successful response. The
backend does not provide pagination or graph discovery.

The top-level `id` is not necessarily a Tableau content LUID. For Tableau REST or other content
tools, use `properties.luid` when the source provides it.
