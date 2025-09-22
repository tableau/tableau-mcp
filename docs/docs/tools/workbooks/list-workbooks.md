---
sidebar_position: 1
---

# List Workbooks

Retrieves a list of workbooks.

## APIs called

- [Query Workbooks for Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbooks_for_site)

## Optional arguments

### `filter`

A
[filter expression](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm)
as defined in the
[Tableau REST API Workbooks filter fields](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm#workbooks).

Example: `name:eq:Superstore`

<hr />

### `pageSize`

The value of the `page-size` argument provided to the
[Query Workbooks for Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbooks_for_site)
REST API. The tool automatically performs pagination and will repeatedly call the REST API until
either all workbooks are retrieved or the `limit` argument has been reached. The `pageSize` argument
will determine how many workbooks to return in each call. You may want to provide a larger value if
you know in advance that you have more than 100 workbooks to retrieve.

Example: `1000`

<hr />

### `limit`

The maximum number of workbooks to return. The tool will return at most this many workbooks.

Example: `2000`

See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/optional.md#max_result_limit)

## Example result

```json
[
  {
    "id": "222ea993-9391-4910-a167-56b3d19b4e3b",
    "name": "Superstore",
    "webpageUrl": "https://10ax.online.tableau.com/#/site/mcp-test/workbooks/1412200",
    "contentUrl": "Superstore",
    "project": {
      "name": "Samples",
      "id": "cbec32db-a4a2-4308-b5f0-4fc67322f359"
    },
    "showTabs": true,
    "defaultViewId": "9460abfe-a6b2-49d1-b998-39e1ebcc55ce",
    "tags": {}
  }
]
```
