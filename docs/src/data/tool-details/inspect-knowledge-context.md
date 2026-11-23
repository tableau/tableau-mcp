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
