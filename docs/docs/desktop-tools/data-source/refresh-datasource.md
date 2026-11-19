---
sidebar_position: 24
---

# Refresh Datasource

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Refresh a datasource in the open workbook.

- `data` runs the toolbar Refresh Data Source action on the live data.
- `extract` refreshes the extract. Omit `isFullRefresh` to use an incremental refresh when one is configured, and a full refresh otherwise.

A credential prompt keeps the refresh running until it is answered in %product_name%. A connection failure ends `FAILED`. A declined prompt ends `CANCELLED`.

## APIs called

This tool asks the running %product_name% instance, through the local **%product_name% %ecapi_name%**, to refresh one datasource in the open workbook. There are no OAuth scopes.

- `refreshType` `data` refreshes the live data.
- `refreshType` `extract` refreshes the extract, incrementally or in full.

## Required arguments

### `datasourceId`

Datasource id from [`get-datasources`](./get-datasources.md) (already percent-encoded), not its name.

#### Example

```json
{ "datasourceId": "Sales%20Extract" }
```

<hr />

### `refreshType`

What to refresh. One of `data` or `extract`.

#### Example

`"extract"`

## Optional arguments

### `session`

Session ID. Optional when a session is pinned or only one %product_name% instance is connected.

#### Example

`"studio-1"`

<hr />

### `isFullRefresh`

Extract only. Omit it to refresh incrementally when an incremental refresh is configured, and in full otherwise. **Refused when `refreshType` is `data`.**

#### Example

`true`

:::note
`isFullRefresh` applies only to `refreshType` `extract`. The tool refuses with `isFullRefresh applies only to refreshType extract. Omit it for a data refresh.`
:::

## Notes and caveats

- `data` refreshes live data. It does not rebuild an extract. Use `refreshType` `extract` for that.
- A datasource with nothing to refresh, and a datasource with no extract when `refreshType` is `extract`, still completes.
- When %product_name% accepts the request before the refresh has settled, the result says the refresh was requested and is still being applied.

## Related

- [`get-datasources`](./get-datasources.md) — lists datasource ids. `isExtract` says whether a datasource has an extract.
