---
sidebar_position: 2
---

# Manage Knowledge Context

Inspects graph status and curates customer-governed semantic context through one management tool. It
is available on Tableau+ sites.

:::warning[Disabled by Default]
This tool requires the `knowledge-tools` feature flag, which defaults to `false` in `features.json`.
See [Feature Flags](../../developers/feature-flags.md).
:::

## Required permissions

- **Site Role**: Requires Creator role or higher
- **Site**: Tableau Knowledge must be enabled on the Tableau+ site

## Actions

| `action`      | Behavior                                                             | Mutation |
| ------------- | -------------------------------------------------------------------- | -------- |
| `status`      | Lists graphs and identifies the primary graph                        | No       |
| `list`        | Lists semantic statements, optionally for one node or global context | No       |
| `suggestions` | Returns a compact graph-health suggestions report                    | No       |
| `create`      | Creates a global context or one attached to `targetNodeId`           | Yes      |
| `update`      | Updates an existing customer-managed context by exact `contextId`    | Yes      |
| `delete`      | Deletes an existing customer-managed context by exact `contextId`    | Yes      |

`create` requires one to 100 non-empty statements and exactly one placement: `isGlobal: true` or
`targetNodeId`. `update` requires `contextId` and at least one changed field. `delete` requires the
exact `contextId`.

```json title="Create global context"
{
  "action": "create",
  "name": "AOV",
  "isGlobal": true,
  "statements": [{ "statement": "AOV is revenue divided by order count." }]
}
```

```json title="Delete context"
{
  "action": "delete",
  "contextId": "semctx:1234"
}
```

Create, update, and delete alter shared graph state. Clients should show the exact proposed change
to the user for approval before calling them. The tool carries conservative MCP annotations: it is
not read-only, may be destructive, and is not idempotent. A successful delete response confirms that
the request completed; because the API is idempotent, it does not claim that the context previously
existed.

## Suggestions response

The tool returns the report's score, statistics, metrics, summary, errors, and capped top-level
suggestions. It omits the duplicate category and topic trees to keep agent context bounded. A graph
status does not by itself prove that every source is synchronized or every recommendation is
current.

## Scopes

The management tool requires both read and write scopes because it combines inspection and curation
in one public contract:

- MCP: `tableau:mcp:knowledge:read`, `tableau:mcp:knowledge:write`
- Tableau API: `tableau:knowledge:read`, `tableau:knowledge:write`

The tool is omitted from sessions where Tableau Knowledge is unavailable. It can also be excluded
with [`EXCLUDE_TOOLS`](../../configuration/mcp-config/env-vars.md#exclude_tools), including through
the `knowledge` tool group.
