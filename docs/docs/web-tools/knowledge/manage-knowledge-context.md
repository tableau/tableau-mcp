---
sidebar_position: 2
---

# Manage Knowledge Context

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Record, revise, or retire the organization's governed business definitions, rules, and notes in
Tableau Knowledge ("add a rule", "update the definition of ...", "remove that note"). Changes are
shared with everyone and every agent that uses the graph, so make sure the exact wording is what the
user wants before writing; when the user has already given the exact change, create or update can be
applied without asking again. Never delete without the user's approval: first show the user the
statement and contextId you would remove, and call delete only after they confirm that target in
their reply. Find the id of an existing rule with inspect-knowledge-context first, and revise a rule
that already exists instead of adding a duplicate. Tell the user exactly what the response says
happened.

## Access requirements

- **User/site role:** `Creator` or higher in the MCP role hierarchy; Tableau content
  permissions and site capabilities also apply.
- **Declared registration minimum:** `Creator`. See [role enforcement](../overview.md#role-enforcement)
  for when this filters the tool list and which roles qualify.
- **Availability:** `KNOWLEDGE_TOOLS_ENABLED` when explicitly set; otherwise `knowledge-tools`.
  Writes additionally require `KNOWLEDGE_WRITE_TOOLS_ENABLED` or, when unset, `knowledge-write-tools`.
- **Registration conditions:** `RequiresKnowledge`.
  See [site capabilities](../overview.md#site-capabilities) for what is checked.

## APIs called

Talks to Tableau Cloud or Tableau Server.

- 
Record, revise, or retire the organization's governed business definitions, rules, and notes in
Tableau Knowledge ("add a rule", "update the definition of ...", "remove that note").

## Required arguments

### `action`

The action argument.

### `graphId`

The graphId argument.

### `contextId`

The contextId argument.

### `statements`

The statements argument.

### `targetNodeId`

The targetNodeId argument.

### `isGlobal`

The isGlobal argument.

### `name`

The name argument.

{/* tool-details */}
## Actions

| `action` | Behavior                                                          | Mutation |
| -------- | ----------------------------------------------------------------- | -------- |
| `create` | Creates a global context or one attached to `targetNodeId`        | Yes      |
| `update` | Updates an existing customer-managed context by exact `contextId` | Yes      |
| `delete` | Deletes an existing customer-managed context by exact `contextId` | Yes      |

`create` requires one to 100 non-empty statements and exactly one placement: `isGlobal: true` or
`targetNodeId`. `update` requires `contextId` and at least one changed field. `delete` requires the
exact `contextId`.

Use [inspect-knowledge-context](./inspect-knowledge-context.md) when you need to find existing
context, check for possible duplicates, or obtain a `contextId`. Inspection is not required when the
user provides a complete, confirmed change with exact identifiers.

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
{/* /tool-details */}
