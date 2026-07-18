---
sidebar_position: 1
---

# List Datasources

Retrieves a list of published data sources.

## APIs called

- [Query Data Sources](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_sources)

## Optional arguments

### `filter`

A
[filter expression](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm)
as defined in the
[Tableau REST API Data Sources filter fields](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm#datasources).

Example: `name:eq:Project Views`

<hr />

### `limit`

The maximum number of data sources to return. The tool will return at most this many data sources.

Example: `2000`

See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit)

## Example result

```json
[
  {
    "id": "2d935df8-fe7e-4fd8-bb14-35eb4ba31d45",
    "name": "Superstore Datasource",
    "description": "*Overview*: Superstore Datasource contains data about your profit and sales\n\n*What is a Row of Data?* Each row of data corresponds to a unique order.",
    "project": {
      "name": "Samples",
      "id": "cbec32db-a4a2-4308-b5f0-4fc67322f359"
    }
  }
]
```
