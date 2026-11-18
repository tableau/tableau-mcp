---
sidebar_position: 2
---

# Get Datasource Metadata

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Retrieves metadata for a specified data source, taking the basic, high-level metadata from
Tableau's VizQL Data Service and enriching it with additional context from Tableau's Metadata
API. Use it to ground a tool that queries Tableau published data sources. The result includes:

- datasource description
- datasource model relationships (when available)
- fields grouped by `logicalTableId`, with properties such as name and `dataType` plus richer
  context such as descriptions, data categories, and roles
- Tableau parameters

## Access requirements

- **User/site role:** `Viewer` or higher in the MCP role hierarchy; Tableau content
  permissions and site capabilities also apply.
- **Declared registration minimum:** `Viewer`. See [role enforcement](../overview.md#role-enforcement)
  for when this filters the tool list and which roles qualify.

## APIs called

The tool reads from two Tableau services — the VizQL Data Service (VDS) API and the Metadata API
(GraphQL) — and, when [tool scoping](../../configuration/mcp-config/tool-scoping.md) is enabled,
first verifies access to the data source through the Tableau REST API (Tableau Cloud or Server).
Callers need the `tableau:mcp:datasource:read` MCP scope; the underlying calls together require
the `tableau:content:read`, `tableau:viz_data_service:read`, and `tableau:mcp_site_settings:read`
OAuth scopes.

- Verify the caller is allowed to access the data source, only when project or tag
  [tool scoping](../../configuration/mcp-config/tool-scoping.md) is configured. Issued against the
  Tableau REST API; requires the `tableau:content:read` and `tableau:mcp_site_settings:read` OAuth
  scopes.
  - `GET /api/{version}/sites/{siteId}/datasources/{datasourceId}` — fetch the data source to
    check its project and tags against the allowed set. [Query Data Source](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_source)
- Read the base data-source metadata (fields, data types, parameters). Issued against the VizQL
  Data Service (VDS) API; requires the `tableau:viz_data_service:read` OAuth scope.
  - `POST /api/v1/vizql-data-service/read-metadata` — request the data source's field metadata.
    [Request data source metadata](https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/ReadMetadata)
- Read the data source model (logical tables and their relationships). Issued against the VizQL
  Data Service (VDS) API; requires the `tableau:viz_data_service:read` OAuth scope.
  - `POST /api/v1/vizql-data-service/get-datasource-model` — request the logical-table model.
    [Request data source model](https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/GetDatasourceModel)
- Enrich the fields with richer context (descriptions, roles, data categories, calculation
  formulas, and owner). Issued against the Metadata API (GraphQL); requires the
  `tableau:content:read` OAuth scope. Skipped when
  [`DISABLE_METADATA_API_REQUESTS`](../../configuration/mcp-config/env-vars.md#disable_metadata_api_requests)`=true`.
  - `POST /api/metadata/graphql` — query `publishedDatasources` field information for the data
    source. [Metadata API](https://help.tableau.com/current/api/metadata_api/en-us/index.html)

## Required arguments

### `datasourceLuid`

The LUID of the data source, potentially retrieved by the [List Data Sources](list-datasources.md)
tool. Must be a non-empty string.

Example: `2d935df8-fe7e-4fd8-bb14-35eb4ba31d45`

:::note
An empty `datasourceLuid` is refused: datasourceLuid must be a non-empty string.
:::

## Optional arguments

### `fieldNames`

Exact, case-sensitive field captions. Returns all matches for duplicate captions.

### `search`

Case-insensitive substring of field caption or description; combined with fieldNames using AND.

### `workbookLuid`

Required to access an embedded (workbook) data source: the LUID of the workbook it belongs to, e.g. the workbook LUID passed to get-workbook. Omit for published data sources.

## Notes and caveats

- Top-level keys are returned in this order: `datasourceDescription`, `datasourceModel`
  (optional), `fieldGroups`, then `parameters`.
- `datasourceModel` is available only on Tableau versions that support the VDS
  `get-datasource-model` endpoint (2025.3+). On older versions it is omitted.
- Metadata API enrichment is best effort: if the Metadata API request fails (for example, the
  service is not enabled) or is turned off via
  [`DISABLE_METADATA_API_REQUESTS`](../../configuration/mcp-config/env-vars.md#disable_metadata_api_requests),
  the tool still returns the VizQL Data Service metadata without the extra context.

## Example result

```json
{
  "datasourceDescription": "Datasource metadata and usage notes...",
  "datasourceModel": {
    "logicalTables": [
      {
        "logicalTableId": "Orders_...",
        "caption": "Orders"
      },
      {
        "logicalTableId": "Returns_...",
        "caption": "Returns"
      }
    ],
    "logicalTableRelationships": [
      {
        "fromLogicalTable": { "logicalTableId": "Orders_..." },
        "toLogicalTable": { "logicalTableId": "Returns_..." },
        "expression": {
          "relationships": [
            {
              "operator": "=",
              "fromField": "[Order ID]",
              "toField": "[Order ID (Returns)]"
            }
          ]
        }
      }
    ]
  },
  "fieldGroups": [
    {
      "logicalTableId": "Orders_...",
      "fields": [
        {
          "name": "Order ID",
          "dataType": "STRING",
          "columnClass": "COLUMN",
          "logicalTableId": "Orders_...",
          "defaultAggregation": "COUNT",
          "dataCategory": "NOMINAL",
          "role": "DIMENSION"
        },
        {
          "name": "Sales",
          "dataType": "REAL",
          "columnClass": "COLUMN",
          "logicalTableId": "Orders_...",
          "defaultAggregation": "SUM",
          "dataCategory": "QUANTITATIVE",
          "role": "MEASURE"
        }
      ]
    },
    {
      "logicalTableId": null,
      "fields": [
        {
          "name": "CrossTable Calc",
          "dataType": "REAL",
          "columnClass": "CALCULATION",
          "logicalTableId": null,
          "defaultAggregation": "SUM",
          "formula": "[Sales] / NULLIF([Quantity], 0)"
        }
      ]
    }
  ],
  "parameters": [
    {
      "name": "Top Customers",
      "parameterType": "QUANTITATIVE_RANGE",
      "dataType": "INTEGER",
      "value": 5,
      "min": 5,
      "max": 20,
      "step": 5
    },
    {
      "name": "Profit Bin Size",
      "parameterType": "QUANTITATIVE_RANGE",
      "dataType": "INTEGER",
      "value": 200,
      "min": 50,
      "max": 200,
      "step": 50
    }
  ]
}
```

## Related

- [`list-datasources`](list-datasources.md) — find the `datasourceLuid` to pass to this tool
- [`query-datasource`](query-datasource.md) — run VizQL queries against a data source once its
  metadata is known

{/* tool-details */}
## Environment variables

- [`DISABLE_METADATA_API_REQUESTS`](../../configuration/mcp-config/env-vars.md#disable_metadata_api_requests)

## Embedded (workbook) data sources

Besides published data sources, this tool can fetch metadata for a data source embedded in a
workbook — pass the embedded data source's `datasourceLuid` (e.g. a connection's datasource ID from
[Get Workbook](../workbooks/get-workbook.md)). A few caveats apply:

- **Site opt-in:** a site administrator must enable querying of workbook (embedded) data sources on
  the Tableau site, otherwise the request returns a "not enabled" error.
- **Permissions:** an embedded data source has no permissions of its own — it inherits those of its
  containing workbook, so you need view/query access to that workbook.
  [Get Workbook](../workbooks/get-workbook.md) reports this up front as
  `queryability.isQueryable`.
- **Version:** requires Tableau 2026.3+ (REST API 3.30 or later); published data sources are
  unaffected.
- **Tool scoping:** when [tool scoping](../../configuration/mcp-config/tool-scoping.md) limits which workbooks are visible, the workbook that contains the embedded data source has to be included.

## Optional field selectors

- `fieldNames`: a nonempty array of exact, case-sensitive **field captions**. All duplicate-caption
  matches are returned. These are captions, not VDS internal field names.
- `search`: a nonblank, case-insensitive substring of a field's caption or description. Leading and
  trailing whitespace is trimmed. With `fieldNames`, both conditions must match.

For example, use `fieldNames: ["Sales", "Order Date"]` for known fields, or `search: "revenue"` to
discover fields whose captions or descriptions contain that text. Selected fields retain their full
metadata, including formulas and descriptions. Empty field groups are omitted.

Search is literal, so related fields and formula dependencies may not match. For broad discovery
or uncertain terminology, omit selectors; fetch referenced fields when needed.

When either selector is supplied, `mcp.resultInfo` reports `totalFields` before selection,
`matchedFields` after both selectors, and `unknownFieldNames` for requested captions absent from the
datasource. A known caption excluded by `search` is not an unknown name. No matches produces empty
`fieldGroups`.

Selectors only affect fields. Parameters, datasource descriptions and model relationships are
returned unchanged. Filtering happens after upstream metadata is fetched; it reduces tool output,
not upstream requests. There is no response-size cap. Omit both selectors for the existing full
response without `mcp.resultInfo`.

## Response shape

1. `datasourceDescription`
2. `datasourceModel` (optional)
3. `fieldGroups`
4. `parameters`
5. `mcp` (only when a field selector is supplied)

`datasourceModel` is available on Tableau versions that support the VDS `get-datasource-model`
endpoint (2025.3+). On older versions, it is omitted.

Fields expose their display caption as `name` and, when available from VDS, their underlying query
name as `fieldName`. Parameters similarly expose `name` and optional `parameterName`. If captions
repeat across logical tables, choose the intended table and use its exact query names with
[`query-datasource`](./query-datasource.md) on Tableau 2025.3+.
Metadata API-only fallback results do not include underlying query names.
{/* /tool-details */}
