---
sidebar_position: 2
---

# Get Datasource Metadata

Fetches datasource metadata for the specified datasource, including:

- datasource description
- datasource model relationships (when available)
- fields grouped by `logicalTableId`
- Tableau parameters

## APIs called

- [Request data source metadata](https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/ReadMetadata)
- [Request data source model](https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/GetDatasourceModel)
- [Metadata API](https://help.tableau.com/current/api/metadata_api/en-us/index.html)
- [Query Data Source](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_source)
  (if applicable [tool scoping](../../configuration/mcp-config/tool-scoping.md) is enabled)
- [Query Workbook Connections](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbook_connections)
  and
  [Get Workbook](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbook)
  (if `workbookLuid` is provided and tool scoping is enabled)

## Environment variables

- [`DISABLE_METADATA_API_REQUESTS`](../../configuration/mcp-config/env-vars.md#disable_metadata_api_requests)

## Required arguments

### `datasourceLuid`

The LUID of the data source, potentially retrieved by the [List Data Sources](list-datasources.md)
tool.

Example: `2d935df8-fe7e-4fd8-bb14-35eb4ba31d45`

## Optional arguments

### `workbookLuid`

The LUID of the workbook an embedded (workbook) data source belongs to, potentially retrieved by the
[Get Workbook](../../tools/workbooks/get-workbook.md) tool. Required to access an embedded data
source when [tool scoping](../../configuration/mcp-config/tool-scoping.md#embedded-data-sources) is
enabled. Ignored for published data sources.

Example: `222ea993-9391-4910-a167-56b3d19b4e3b`

## Embedded (workbook) data sources

Besides published data sources, this tool can fetch metadata for a data source embedded in a
workbook — pass the embedded data source's `datasourceLuid` (e.g. a connection's datasource ID from
[Get Workbook](../../tools/workbooks/get-workbook.md)). A few caveats apply:

- **Site opt-in:** a site administrator must enable querying of workbook (embedded) data sources on
  the Tableau site, otherwise the request returns a "not enabled" error.
- **Permissions:** an embedded data source has no permissions of its own — it inherits those of its
  containing workbook, so you need view/query access to that workbook.
  [Get Workbook](../../tools/workbooks/get-workbook.md) reports this up front as
  `queryability.isQueryable`.
- **Version:** requires Tableau 2026.3+ (REST API 3.30 or later); published data sources are
  unaffected.
- **Tool scoping:** when
  [tool scoping](../../configuration/mcp-config/tool-scoping.md#embedded-data-sources) is enabled,
  also pass [`workbookLuid`](#workbookluid).

## Response shape

Top-level keys are returned in this order:

1. `datasourceDescription`
2. `datasourceModel` (optional)
3. `fieldGroups`
4. `parameters`

`datasourceModel` is available on Tableau versions that support the VDS `get-datasource-model`
endpoint (2025.3+). On older versions, it is omitted.

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
