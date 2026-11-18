## Arguments no longer accepted

These arguments were described on an earlier page and are not accepted by the current tool.

### `excludeSheets`

Worksheet names to opt out of a dashboard-scoped URL action, so marks on those sheets do not fire it.

:::note
`excludeSheets` is only allowed with a dashboard-only source: set `sourceDashboard` and leave `sourceWorksheet` empty.
:::

#### Example

```json
{ "excludeSheets": ["Sales", "OTE"] }
```

<hr />
