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
  from REST API (if data source [tool scoping](../../configuration/mcp-config/tool-scoping.md) is
  enabled)

## Environment variables

- [`DISABLE_QUERY_DATASOURCE_FILTER_VALIDATION`](../../configuration/mcp-config/optional.md#disable_query_datasource_filter_validation)

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
