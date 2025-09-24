---
sidebar-position: 1
---

# Search Content

Searches across all supported content types in a Tableau Site for objects relevant to the search query.

## APIs called

- [Get Content Search Results](https://help.tableau.com/current/api/rest_api/en-us/REST/TAG/index.html#tag/Content-Exploration-Methods/operation/ContentExplorationService_getSearch)

## Optional arguments

### `terms`

A string containing one or more search terms that the search uses as the basis for determining which items are relevant to return. If the terms parameter is not provided, it searches for everything bound by the specified filters.

Example: `"Regional Sales"`

<hr />

### `limit`

The number of items to return in the search response. Default limit is 100 and max value is 2000 items.

Example: `100`

See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/optional.md#max_result_limit)

<hr />

### `orderBy`

Determines the sorting method for returned items. Available sorting methods:

- `hitsTotal`: Number of times a content item has been viewed since it was created
- `hitsSmallSpanTotal`: Number of times a content item was viewed in the last month
- `hitsMediumSpanTotal`: Number of times a content item was viewed in the last 3 months
- `hitsLargeSpanTotal`: Number of times a content item was viewed in the last year
- `downstreamWorkbookCount`: Number of workbooks in a given project. This value is only available when the content type filter includes 'database' or 'table'

For each sort method, you can specify a sort direction: `"asc"` for ascending or `"desc"` for descending (default: `"asc"`).

The `orderBy` parameter is an array of objects containing the sorting method and direction. The first element determines primary sorting, with subsequent elements used as tiebreakers.

If the `orderBy` parameter is ommitted, the search will sort items by their "relevance score" in descending order, which is Tableau's internal algorithm for providing the most relevant results.

Example:

```json
[
  {
    "method": "hitsSmallSpanTotal",
    "sortDirection": "desc"
  },
  {
    "method": "hitsMediumSpanTotal",
    "sortDirection": "desc"
  }
]
```

<hr />

### `filter`

An object that allows you to limit search results based on:
- `contentTypes`: Filter by content types (array of strings). Supported types are: "lens", "datasource", "virtualconnection", "collection", "project", "flow", "datarole", "table", "database", "view", "workbook"
- `ownerIds`: Filter by specific owner IDs (array of integers)
- `modifiedTime`: Filter by last modified times using ISO 8601 date-time strings. Can be either a range (with startDate/endDate) or an array of specific date-times to include

The `filter` object is optional, but if it is provided it only requires one of the three filtering methods (`contentTypes`, `ownerIds`, or `modifiedTime`)

Example:

```json
{
  "contentTypes": ["workbook","datasource"],
  "modifiedTime": {
    "startDate": "2025-01-01T00:00:00.000Z"
  }
}
```

Example:

```json
{
  "ownerIds": [12345,67890],
  "modifiedTime": [
    "2025-02-01T20:01:03Z",
    "2024-11-15T14:23:07Z",
    "2024-12-08T09:45:33Z",
    "2025-01-22T16:12:58Z",
    "2025-03-07T11:37:21Z",
    "2025-04-18T20:55:14Z"
  ]
}
```
