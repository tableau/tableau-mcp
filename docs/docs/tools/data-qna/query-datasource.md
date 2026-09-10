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

### `limit`

The maximum number of rows to return. The tool will return at most this many rows.

Example: `2000`

See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit)

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
