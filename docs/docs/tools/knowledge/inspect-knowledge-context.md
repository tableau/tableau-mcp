---
sidebar_position: 2
---

# Inspect Knowledge Context

Inspects graph availability, existing semantic context, health, and improvement suggestions without
changing the Tableau Knowledge graph. This read-only tool is available on Tableau+ sites.

:::warning[Disabled by Default]
This tool requires the `knowledge-tools` feature flag, which defaults to `false` in `features.json`.
See [Feature Flags](../../developers/feature-flags.md).
:::

## Required permissions

- **Site Role**: Available to Viewer roles and higher
- **Site**: Tableau Knowledge must be enabled on the Tableau+ site

## Actions

| `action`      | Behavior                                                             |
| ------------- | -------------------------------------------------------------------- |
| `status`      | Lists graphs and identifies the primary graph                        |
| `list`        | Lists semantic statements, optionally for one node or global context |
| `suggestions` | Returns a compact graph-health and coverage report                   |

```json title="Inspect graph health"
{
  "action": "suggestions",
  "severity": "high",
  "limit": 25
}
```

The suggestions response contains the report's health score, statistics, metrics, summary, errors,
and capped top-level suggestions. It omits the duplicate category and topic trees to keep agent
context bounded. A graph status does not by itself prove that every source is synchronized or every
recommendation is current.

## Limits

`limit` defaults to 25 and is capped at 100. It limits returned graphs, flattened semantic
statements, suggestions, metrics, and errors. `MAX_RESULT_LIMIT` and
`MAX_RESULT_LIMITS=inspect-knowledge-context:N` can lower the limit.

## Scopes

- MCP: `tableau:mcp:knowledge:read`
- Tableau API: `tableau:knowledge:read`

The tool is omitted from sessions where Tableau Knowledge is unavailable. It can also be excluded
with [`EXCLUDE_TOOLS`](../../configuration/mcp-config/env-vars.md#exclude_tools), including through
the `knowledge` tool group.
