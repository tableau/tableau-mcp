---
sidebar_position: 3
---

# Manage Knowledge Context

Creates, updates, and deletes customer-governed semantic context. It is available on Tableau+ sites.

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
| `create`      | Creates a global context or one attached to `targetNodeId`           | Yes      |
| `update`      | Updates an existing customer-managed context by exact `contextId`    | Yes      |
| `delete`      | Deletes an existing customer-managed context by exact `contextId`    | Yes      |

`create` requires one to 100 non-empty statements and exactly one placement: `isGlobal: true` or
`targetNodeId`. `update` requires `contextId` and at least one changed field. `delete` requires the
exact `contextId`.

Use [inspect-knowledge-context](inspect-knowledge-context.md) when you need to find existing context,
check for possible duplicates, or obtain a `contextId`. Inspection is not required when the user
provides a complete, confirmed change with exact identifiers.

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

## Scopes

- MCP: `tableau:mcp:knowledge:write`
- Tableau API: `tableau:knowledge:write`

The tool is omitted from sessions where Tableau Knowledge is unavailable. It can also be excluded
with [`EXCLUDE_TOOLS`](../../configuration/mcp-config/env-vars.md#exclude_tools), including through
the `knowledge` tool group.
