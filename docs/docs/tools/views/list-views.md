---
sidebar_position: 1
---

# List Views

Retrieves a list of views.

## APIs called

- [Query Views for Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_views_for_site)

## Optional arguments

### `filter`

A
[filter expression](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm)
as defined in the
[Tableau REST API Views filter fields](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm#views).

Example: `name:eq:Overview`

<hr />

### `pageSize`

The value of the `page-size` argument provided to the
[Query Views for Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_views_for_site)
REST API. The tool automatically performs pagination and will repeatedly call the REST API until
either all views are retrieved or the `limit` argument has been reached. The `pageSize` argument
will determine how many views to return in each call. You may want to provide a larger value if you
know in advance that you have more than 100 views to retrieve.

Example: `1000`

<hr />

### `limit`

The maximum number of views to return. The tool will return at most this many views.

Example: `2000`

See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/optional.md#max_result_limit)

## Example result

```json
[
  {
    "id": "9460abfe-a6b2-49d1-b998-39e1ebcc55ce",
    "name": "Overview",
    "createdAt": "2025-09-02T23:25:58Z",
    "updatedAt": "2025-09-02T23:25:58Z",
    "workbook": {
      "id": "222ea993-9391-4910-a167-56b3d19b4e3b"
    },
    "owner": {
      "id": "d2a1e1df-af8e-4f43-a4cc-34858b7f8b69"
    },
    "project": {
      "id": "cbec32db-a4a2-4308-b5f0-4fc67322f359"
    },
    "tags": {},
    "usage": {
      "totalViewCount": 0
    }
  }
]
```
