---
sidebar_position: 2
---

# Get Datasource Metadata

Fetches field metadata for the specified datasource.

## APIs called

- [Request data source metadata](https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/ReadMetadata)
- [Metadata API](https://help.tableau.com/current/api/metadata_api/en-us/index.html)
- [Query Data Source](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_source)
  (if data source [tool scoping](../../configuration/mcp-config/tool-scoping.md) is enabled)

## Environment variables

- [`DISABLE_METADATA_API_REQUESTS`](../../configuration/mcp-config/optional.md#disable_metadata_api_requests)

## Required arguments

### `datasourceLuid`

The LUID of the data source, potentially retrieved by the [List Data Sources](list-datasources.md)
tool.

Example: `2d935df8-fe7e-4fd8-bb14-35eb4ba31d45`

## Example result

```json
{
  "fields": [
    {
      "name": "Returned",
      "dataType": "STRING",
      "columnClass": "COLUMN",
      "defaultAggregation": "COUNT",
      "dataCategory": "NOMINAL",
      "role": "DIMENSION"
    },
    {
      "name": "Category",
      "dataType": "STRING",
      "columnClass": "COLUMN",
      "defaultAggregation": "COUNT",
      "dataCategory": "NOMINAL",
      "role": "DIMENSION"
    },
    {
      "name": "Discount",
      "dataType": "REAL",
      "columnClass": "COLUMN",
      "defaultAggregation": "SUM",
      "dataCategory": "QUANTITATIVE",
      "role": "MEASURE"
    },
    {
      "name": "Postal Code",
      "dataType": "STRING",
      "columnClass": "COLUMN",
      "defaultAggregation": "COUNT",
      "dataCategory": "ORDINAL",
      "role": "DIMENSION",
      "defaultFormat": "*00000"
    },
    {
      "name": "Regional Manager",
      "dataType": "STRING",
      "defaultAggregation": "COUNT"
    },
    {
      "name": "Order ID",
      "dataType": "STRING",
      "columnClass": "COLUMN",
      "defaultAggregation": "COUNT",
      "dataCategory": "NOMINAL",
      "role": "DIMENSION"
    },
    {
      "name": "Product Name",
      "dataType": "STRING",
      "columnClass": "COLUMN",
      "defaultAggregation": "COUNT",
      "dataCategory": "NOMINAL",
      "role": "DIMENSION"
    },
    {
      "name": "Ship Date",
      "dataType": "DATE",
      "columnClass": "COLUMN",
      "defaultAggregation": "YEAR",
      "dataCategory": "ORDINAL",
      "role": "DIMENSION"
    },
    {
      "name": "Quantity",
      "dataType": "INTEGER",
      "columnClass": "COLUMN",
      "defaultAggregation": "SUM",
      "dataCategory": "QUANTITATIVE",
      "role": "MEASURE"
    },
    {
      "name": "City",
      "dataType": "STRING",
      "columnClass": "COLUMN",
      "defaultAggregation": "COUNT",
      "dataCategory": "NOMINAL",
      "role": "DIMENSION"
    },
    {
      "name": "Sub-Category",
      "dataType": "STRING",
      "columnClass": "COLUMN",
      "defaultAggregation": "COUNT",
      "dataCategory": "NOMINAL",
      "role": "DIMENSION"
    },
    {
      "name": "Profit (bin)",
      "dataType": "INTEGER",
      "columnClass": "BIN",
      "defaultAggregation": "NONE",
      "formula": "[Profit]",
      "dataCategory": "ORDINAL",
      "role": "DIMENSION"
    },
    {
      "name": "Segment",
      "dataType": "STRING",
      "columnClass": "COLUMN",
      "defaultAggregation": "COUNT",
      "dataCategory": "NOMINAL",
      "role": "DIMENSION"
    },
    {
      "name": "State/Province",
      "dataType": "STRING",
      "columnClass": "COLUMN",
      "defaultAggregation": "COUNT",
      "dataCategory": "NOMINAL",
      "role": "DIMENSION"
    },
    {
      "name": "Sales",
      "dataType": "REAL",
      "columnClass": "COLUMN",
      "defaultAggregation": "SUM",
      "dataCategory": "QUANTITATIVE",
      "role": "MEASURE"
    },
    {
      "name": "Manufacturer",
      "dataType": "STRING",
      "columnClass": "GROUP",
      "defaultAggregation": "COUNT",
      "dataCategory": "NOMINAL",
      "role": "DIMENSION"
    },
    {
      "name": "Region",
      "dataType": "STRING",
      "columnClass": "COLUMN",
      "defaultAggregation": "COUNT",
      "dataCategory": "NOMINAL",
      "role": "DIMENSION"
    },
    {
      "name": "Ship Mode",
      "dataType": "STRING",
      "columnClass": "COLUMN",
      "defaultAggregation": "COUNT",
      "dataCategory": "NOMINAL",
      "role": "DIMENSION"
    },
    {
      "name": "Order Date",
      "dataType": "DATE",
      "columnClass": "COLUMN",
      "defaultAggregation": "YEAR",
      "dataCategory": "ORDINAL",
      "role": "DIMENSION"
    },
    {
      "name": "Profit",
      "dataType": "REAL",
      "columnClass": "COLUMN",
      "defaultAggregation": "SUM",
      "dataCategory": "QUANTITATIVE",
      "role": "MEASURE"
    },
    {
      "name": "Country/Region",
      "dataType": "STRING",
      "columnClass": "COLUMN",
      "defaultAggregation": "COUNT",
      "dataCategory": "NOMINAL",
      "role": "DIMENSION"
    },
    {
      "name": "Profit Ratio",
      "dataType": "REAL",
      "columnClass": "CALCULATION",
      "defaultAggregation": "AGG",
      "formula": "SUM([Profit])/SUM([Sales])",
      "dataCategory": "QUANTITATIVE",
      "role": "MEASURE",
      "isAutoGenerated": false,
      "hasUserReference": false
    },
    {
      "name": "Customer Name",
      "dataType": "STRING",
      "columnClass": "COLUMN",
      "defaultAggregation": "COUNT",
      "dataCategory": "NOMINAL",
      "role": "DIMENSION"
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
