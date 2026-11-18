---
sidebar_position: 3
---

# Query Datasource

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Executes VizQL queries against a published Tableau data source to answer business questions from
your data. The tool is read-only: it runs the query you supply and returns the resulting rows.

## Access requirements

- **User/site role:** `Viewer` or higher in the MCP role hierarchy; Tableau content
  permissions and site capabilities also apply.
- **Declared registration minimum:** `Viewer`. See [role enforcement](../overview.md#role-enforcement)
  for when this filters the tool list and which roles qualify.

## APIs called

This tool runs its queries against the VizQL Data Service (VDS) API (served by Tableau Cloud or
Tableau Server), and — only when tool scoping restricts which data sources may be queried — reads
data source details from the Tableau REST API. The MCP-layer gate requires the
`tableau:mcp:datasource:read` scope.

- Runs the supplied query against the data source and returns the result rows. Issued against the
  VizQL Data Service (VDS) API; requires the `tableau:viz_data_service:read` OAuth scope.
  - `POST /api/v1/vizql-data-service/query-datasource` — execute the query and return the data.
    [Query Data Source](https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/QueryDatasource)
- Validates the query before running it — checking fields, parameters, and `SET`/`MATCH` filter
  values against the data source — so a malformed query can self-heal. Skipped when
  [`DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS`](../../configuration/mcp-config/env-vars.md#disable_query_datasource_validation_requests)
  is set. Issued against the VizQL Data Service (VDS) API; requires the
  `tableau:viz_data_service:read` OAuth scope.
  - `POST /api/v1/vizql-data-service/read-metadata` — read field and parameter metadata to validate
    the query against the data source.
    [Read Metadata](https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/ReadMetadata)
  - `POST /api/v1/vizql-data-service/query-datasource` — sample the field's values to validate
    `SET` and `MATCH` filter values.
    [Query Data Source](https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/QueryDatasource)
- Confirms the requested data source is within the configured
  [tool scoping](../../configuration/mcp-config/tool-scoping.md) bounded context, only when project
  or tag scoping is configured. Issued against the Tableau REST API; requires the
  `tableau:content:read` and `tableau:mcp_site_settings:read` OAuth scopes.
  - `GET /api/{version}/sites/{siteId}/datasources/{datasourceId}` — fetch the data source to check
    its project and tags.
    [Query Data Source](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_source)

## Required arguments

### `datasourceLuid`

The LUID of the data source, potentially retrieved by the [List Data Sources](list-datasources.md)
tool.

#### Example

`2d935df8-fe7e-4fd8-bb14-35eb4ba31d45`

<hr />

### `query`

The VizQL query to execute against the data source. See
[Create a Query](https://help.tableau.com/current/api/vizql-data-service/en-us/docs/vds_create_queries.html)
for more information.

Some query features need a recent Tableau version. The tool rejects them on earlier versions with an
error that names the version they need:

- Table calculation fields (`tableCalculation`) require Tableau 2025.3 or later.
- `CONDITION` filters require Tableau 2026.1 or later.

#### Example

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

## Optional arguments

### `limit`

The maximum number of rows to return. The tool returns at most this many rows. `Range: 1-` (a
positive integer). When [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit)
is configured, the effective cap is the smaller of that limit and this value.

See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit)

#### Example

`2000`

### `interpretFieldCaptionsAsFieldNames`

Requires Tableau 2025.3 or later. Set to `true` to use the exact `fieldName` and `parameterName`
values returned by [Get Datasource Metadata](get-datasource-metadata.md), for example when several
logical tables contain fields with the same display caption. Choose the intended logical table; do
not invent or qualify names yourself.

On earlier versions, this argument is omitted from the tool schema and the metadata tool does not
recommend field-name queries. The runtime version check still rejects clients that send `true`.

Use underlying names consistently for existing fields and parameters, including bracketed references
inside calculation expressions. The VDS request properties remain `fieldCaption` and
`parameterCaption`; their values are interpreted as underlying names when this option is enabled. A
new ad hoc calculation's `fieldCaption` remains a caller-chosen output label.

For example, if metadata returns `fieldName: "staffing_cost"`, reference `[staffing_cost]` inside
the formula:

```json
{
  "interpretFieldCaptionsAsFieldNames": true,
  "query": {
    "fields": [
      {
        "fieldCaption": "Total staffing cost",
        "calculation": "SUM([staffing_cost])"
      }
    ]
  }
}
```

Omit or set to `false` to retain display-caption queries. Earlier Tableau versions reject `true`
before datasource requests, including when supplementary query validation is disabled.

### `workbookLuid`

The LUID of the workbook an embedded (workbook) data source belongs to, potentially retrieved by the
[Get Workbook](../../web-tools/workbooks/get-workbook.md) tool. Required to access an embedded data
source when [tool scoping](../../configuration/mcp-config/tool-scoping.md#embedded-data-sources) is
enabled. Ignored for published data sources.

Example: `222ea993-9391-4910-a167-56b3d19b4e3b`

## Notes and caveats

:::note[Query validation]
Before running the query, the tool may issue additional VizQL Data Service requests to validate
inputs such as string filter values and the semantic accuracy of the generated query. Setting
[`DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS`](../../configuration/mcp-config/env-vars.md#disable_query_datasource_validation_requests)
disables those supplementary calls. We do **not** recommend turning them off: they help an agent
self-heal from malformed queries and produce more accurate answers from your data.
:::

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

{/* tool-details */}
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
{/* /tool-details */}
