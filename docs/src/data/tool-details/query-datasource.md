## Environment variables

- [`DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS`](../../configuration/mcp-config/env-vars.md#disable_query_datasource_validation_requests)

  The `query-datasource` tool may issue additional VizQL Data Service and Metadata API requests to validate inputs such as string filter values and the semantic accuracy of the generated query. Setting this variable disables those supplementary calls. We do **not** recommend turning them off: they help an agent self-heal from malformed queries and produce more accurate answers from your data.

## Embedded (workbook) data sources

Besides published data sources, this tool can query a data source embedded in a workbook — pass the
embedded data source's `datasourceLuid` (e.g. a connection's datasource ID from
[Get Workbook](../workbooks/get-workbook.md)). A few caveats apply:

- **Site opt-in:** a site administrator must enable querying of workbook (embedded) data sources on
  the Tableau site, otherwise the query returns a "not enabled" error.
- **Permissions:** an embedded data source has no permissions of its own — it inherits those of its
  containing workbook, so you need view/query access to that workbook.
  [Get Workbook](../workbooks/get-workbook.md) reports this up front as
  `queryability.isQueryable`.
- **Version:** requires Tableau 2026.3+ (REST API 3.30 or later); published data sources are
  unaffected.
- **Tool scoping:** when [tool scoping](../../configuration/mcp-config/tool-scoping.md) limits which workbooks are visible, the workbook that contains the embedded data source has to be included.

## Warnings

The tool validates the query for a common pitfall: combining a `TOP`/`BOTTOM` filter with one or
more dimension filters (`SET`, `DATE`, `MATCH`, or a non-aggregated `QUANTITATIVE_NUMERICAL`/
`QUANTITATIVE_DATE` filter) that don't set `context: true`. In Tableau's query order of
operations, `TOP`/`BOTTOM` filters are evaluated *before* regular dimension filters, so the `TOP`
filter selects from the full dataset first and the dimension filters are applied afterward — this
can produce fewer results than expected (e.g. 8 rows when requesting Top 10), because some of the
top-ranked values may not exist in the filtered subset.

When this pattern is detected, the result includes a non-blocking `mcp.warnings` array (the query
still executes and returns data):

```json
{
  "data": [ /* ... */ ],
  "mcp": {
    "warnings": [
      {
        "type": "MISSING_CONTEXT_ON_DIMENSION_FILTER",
        "severity": "WARNING",
        "message": "This query combines a TOP/BOTTOM filter with dimension filters that are not set as context filters. ...",
        "affectedFilters": ["Region"]
      }
    ]
  }
}
```

If the intent is to find the Top values *within* the filtered subset, add `"context": true` to
the affected dimension filter(s). If the intent is to find the Top values globally and then
filter them, no change is needed — the warning can be ignored.

### Ignored request properties

When a [`datasource`](#datasource) or [`options`](#options) property is accepted but not used, the
result carries an `IGNORED_REQUEST_PROPERTY` warning naming it. The query still runs:

```json
{
  "data": [ /* ... */ ],
  "mcp": {
    "warnings": [
      {
        "type": "IGNORED_REQUEST_PROPERTY",
        "severity": "WARNING",
        "message": "The tool always uses returnFormat: \"OBJECTS\", so the values you passed were ignored.",
        "affectedProperties": ["options.returnFormat"]
      }
    ]
  }
}
```
