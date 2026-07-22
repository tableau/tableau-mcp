---
sidebar_position: 1
---

# List Datasources

Retrieves a list of published data sources.

This tool returns a single page of up to 1000 data sources per call. The response is a
flat object of the shape `{ data, totalAvailable }` (see
[Example result](#example-result)). To collect every data source, start at `pageNumber: 1`
and increment `pageNumber` on each subsequent call until you have collected
`totalAvailable` items.

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

### `pageNumber`

Which 1000-item page of data sources to fetch. This is a 1-based page index (page size is
fixed at 1000); when omitted it defaults to `1`. Increment `pageNumber` across calls to page
through the full result set.

Example: `2`

<hr />

### `limit`

The maximum number of data sources to return **from the requested page**. Must be a positive
integer no greater than 1000 (the fixed page size). Use this to fetch fewer than a full page —
for example, to request a partial final page. It does not fetch across pages.

Example: `600`

See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit),
the overall cap on how many results can be paginated through across all pages.

## Example result

```json
{
  "data": [
    {
      "id": "2d935df8-fe7e-4fd8-bb14-35eb4ba31d45",
      "name": "Superstore Datasource",
      "description": "*Overview*: Superstore Datasource contains data about your profit and sales\n\n*What is a Row of Data?* Each row of data corresponds to a unique order.",
      "project": {
        "name": "Samples",
        "id": "cbec32db-a4a2-4308-b5f0-4fc67322f359"
      }
    }
  ],
  "totalAvailable": 1
}
```

The response fields are:

- `data`: the data sources on the requested page (at most 1000, or fewer when `limit` or a
  server cap applies).
- `totalAvailable`: the number of data sources the client should paginate up to. This is
  `min(rawTotal, MAX_RESULT_LIMIT)` — equal to Tableau's raw total for the query when no
  server-side cap is configured, and capped to [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit)
  when one is in force. Your own `limit` argument does not affect this value.
