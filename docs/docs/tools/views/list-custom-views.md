---
sidebar_position: 4
---

# List Custom Views

Retrieves a list of custom views for a specified Tableau workbook.

## APIs called

- [Get Workbook](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbook)
- [List Custom Views](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#list_custom_views)

## Required arguments

### `workbookId`

The ID of the workbook containing the custom view, potentially retrieved by the
[List Workbooks](../workbooks/list-workbooks.md) tool.

Example: `222ea993-9391-4910-a167-56b3d19b4e3b`

## Optional arguments

### `filter`

A
[filter expression](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm)
using only these supported Tableau REST API Custom Views filter fields:

- `viewId:eq:<viewId>`
- `ownerId:eq:<ownerId>`

Example: `viewId:eq:9460abfe-a6b2-49d1-b998-39e1ebcc55ce`

:::warning

The tool always includes `workbookId` in the filter expression based on the required
[`workbookId`](#workbookid) argument. Including the `workbookId` field in the filter will be
ignored.

:::

<hr />

### `pageSize`

The value of the `page-size` argument provided to the
[List Custom Views](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#list_custom_views)
REST API. The tool automatically performs pagination and will repeatedly call the REST API until
either all custom views are retrieved or the `limit` argument has been reached. The `pageSize`
argument will determine how many custom views to return in each call. You may want to provide a
larger value if you know in advance that you have more than 100 custom views to retrieve.

Example: `1000`

<hr />

### `limit`

The maximum number of custom views to return. The tool will return at most this many custom views.

Example: `2000`

See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit)

## Example result

```json
[
  {
    "id": "1db3a121-51ac-4435-b533-3053e698dfc8",
    "name": "My Custom View",
    "createdAt": "2026-03-26T17:34:21Z",
    "updatedAt": "2026-03-31T22:06:29Z",
    "lastAccessedAt": "2026-03-31T22:06:29Z",
    "shared": false,
    "view": {
      "id": "9460abfe-a6b2-49d1-b998-39e1ebcc55ce",
      "name": "Overview"
    },
    "workbook": {
      "id": "222ea993-9391-4910-a167-56b3d19b4e3b",
      "name": "Superstore"
    },
    "owner": {
      "id": "bbdee366-4a50-4c2c-a5c8-746da5b64483",
      "name": "andrew.young@tableau.com"
    }
  }
]
```
