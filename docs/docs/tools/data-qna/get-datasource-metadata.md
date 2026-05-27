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
  (if applicable [tool scoping](../../configuration/mcp-config/tool-scoping.md) is enabled, and one
  call per `STRING` field when `sampleStringValues` is `true`)

## Environment variables

- [`DISABLE_METADATA_API_REQUESTS`](../../configuration/mcp-config/env-vars.md#disable_metadata_api_requests)

## Required arguments

### `datasourceLuid`

The LUID of the data source, potentially retrieved by the [List Data Sources](list-datasources.md)
tool.

Example: `2d935df8-fe7e-4fd8-bb14-35eb4ba31d45`

## Optional arguments

### `sampleStringValues`

When `true` (the default), the response includes up to 3 distinct sample values for each field whose
`dataType` is `STRING`, in a `sampleValues: string[]` property on that field. This helps downstream
tools (such as [Query Datasource](query-datasource.md)) construct accurate `SET` and `MATCH`
filters without first making an additional discovery query.

Set to `false` to skip these per-field sample queries. Useful for very wide datasources where the
additional latency or token cost outweighs the value, or when only schema-level information is
needed. When `false`, the `sampleValues` property is omitted from every field.

Default: `true`

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
          "role": "DIMENSION",
          "sampleValues": ["CA-2017-152156", "CA-2017-138688", "US-2018-108966"]
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
