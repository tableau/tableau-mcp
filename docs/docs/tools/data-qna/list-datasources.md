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

### `pageSize`

The value of the `page-size` argument provided to the
[Query Data Sources](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_sources)
REST API. The tool automatically performs pagination and will repeatedly call the REST API until
either all data sources are retrieved or the `limit` argument has been reached. The `pageSize`
argument will determine how many data sources to return in each call. You may want to provide a
larger value if you know in advance that you have more than 100 data sources to retrieve.

Example: `1000`

<hr />

### `limit`

The maximum number of data sources to return. The tool will return at most this many data sources.

Example: `2000`

See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/optional.md#max_result_limit)

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
