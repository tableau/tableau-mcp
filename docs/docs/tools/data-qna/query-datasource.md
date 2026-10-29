---
sidebar_position: 3
---

# Query Datasource

Executes VizQL queries against Tableau data sources to answer business questions from published
data.

## APIs called

- [Query Data Source](https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/QueryDatasource)
  from VizQL Data Service
- [Query Data Source](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_source)
  from REST API (if applicable [tool scoping](../../configuration/mcp-config/tool-scoping.md) is
  enabled)
- [Query Workbook Connections](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbook_connections)
  and
  [Get Workbook](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbook)
  (if `workbookLuid` is provided and tool scoping is enabled)

## Environment variables

- [`DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS`](../../configuration/mcp-config/env-vars.md#disable_query_datasource_validation_requests)

  The `query-datasource` tool may issue additional VizQL Data Service and Metadata API requests to validate inputs such as string filter values and the semantic accuracy of the generated query. Setting this variable disables those supplementary calls. We do **not** recommend turning them off: they help an agent self-heal from malformed queries and produce more accurate answers from your data.

## Required arguments

### `datasourceLuid`

The LUID of the data source, potentially retrieved by the [List Data Sources](list-datasources.md)
tool.

Example: `2d935df8-fe7e-4fd8-bb14-35eb4ba31d45`

<hr />

### `query`

The VizQL query to execute against the data source. See
[Create a Query](https://help.tableau.com/current/api/vizql-data-service/en-us/docs/vds_create_queries.html)
for more information.

Example:

```json
{
  "fields": [
    {
      "fieldCaption": "Customer Name"
    },
    {
      "fieldCaption": "Sales",
      "function": "SUM",
      "fieldAlias": "Total Revenue",
      "sortDirection": "DESC",
      "sortPriority": 1
    }
  ],
  "filters": [
    {
      "field": {
        "fieldCaption": "Customer Name"
      },
      "filterType": "TOP",
      "howMany": 5,
      "direction": "TOP",
      "fieldToMeasure": {
        "fieldCaption": "Sales",
        "function": "SUM"
      }
    }
  ]
}
```

<hr />

## Optional arguments

### `interpretFieldCaptionsAsFieldNames`

Requires Tableau 2025.3 or later. Set to `true` to use the exact `fieldName` and `parameterName`
values returned by [Get Datasource Metadata](get-datasource-metadata.md), for example when several
logical tables contain fields with the same display caption. Choose the intended logical table; do
not invent or qualify names yourself.

On earlier versions, this argument is omitted from the tool schema and the metadata tool does not
recommend field-name queries. The runtime version check still rejects clients that send `true`.

Use underlying names consistently for existing fields in selections, filters, calculations and
parameters. The VDS request properties remain `fieldCaption` and `parameterCaption`; their values
are interpreted as underlying names when this option is enabled.

Omit or set to `false` to retain display-caption queries. Earlier Tableau versions reject `true`
before datasource requests, including when supplementary query validation is disabled.

<hr />

### `limit`

The maximum number of rows to return. The tool will return at most this many rows.

When a row limit applies (this argument, `MAX_RESULT_LIMIT` or a per-tool `MAX_RESULT_LIMITS` entry),
the response includes `mcp.resultInfo` with `returnedCount` and `truncated`. If `truncated` is
`true`, more rows matched; `truncationReason` is `admin-cap` when a server cap cut the results, or
`requested-limit` when this argument did. `mcp.resultInfo` is absent when no row limit applies.

Example: `2000`

See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit),
[`MAX_RESULT_LIMITS`](../../configuration/mcp-config/env-vars.md#max_result_limits)

<hr />

### `workbookLuid`

The LUID of the workbook an embedded (workbook) data source belongs to, potentially retrieved by the
[Get Workbook](../../tools/workbooks/get-workbook.md) tool. Required to access an embedded data
source when [tool scoping](../../configuration/mcp-config/tool-scoping.md#embedded-data-sources) is
enabled. Ignored for published data sources.

Example: `222ea993-9391-4910-a167-56b3d19b4e3b`

## Embedded (workbook) data sources

Besides published data sources, this tool can query a data source embedded in a workbook — pass the
embedded data source's `datasourceLuid` (e.g. a connection's datasource ID from
[Get Workbook](../../tools/workbooks/get-workbook.md)). A few caveats apply:

- **Site opt-in:** a site administrator must enable querying of workbook (embedded) data sources on
  the Tableau site, otherwise the query returns a "not enabled" error.
- **Permissions:** an embedded data source has no permissions of its own — it inherits those of its
  containing workbook, so you need view/query access to that workbook.
  [Get Workbook](../../tools/workbooks/get-workbook.md) reports this up front as
  `queryability.isQueryable`.
- **Version:** requires Tableau 2026.3+ (REST API 3.30 or later); published data sources are
  unaffected.
- **Tool scoping:** when
  [tool scoping](../../configuration/mcp-config/tool-scoping.md#embedded-data-sources) is enabled,
  also pass [`workbookLuid`](#workbookluid).

## Example result

```json
{
  "data": [
    {
      "Customer Name": "Sean Miller",
      "Total Revenue": 25043.05
    },
    {
      "Customer Name": "Tamara Chand",
      "Total Revenue": 19052.217999999997
    },
    {
      "Customer Name": "Raymond Buch",
      "Total Revenue": 15117.338999999998
    },
    {
      "Customer Name": "Tom Ashbrook",
      "Total Revenue": 14595.62
    },
    {
      "Customer Name": "Adrian Barton",
      "Total Revenue": 14473.571
    }
  ]
}
```

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
