---
sidebar_position: 4
---

# List Custom Views

Retrieves a list of custom views for a specified Tableau workbook.

This tool returns a single page of results (up to 1000 items). The response is a JSON object of
the shape `{ data, totalAvailable }`:

- `data`: the custom views on the requested page (at most 1000).
- `totalAvailable`: the number of custom views the client should paginate up to. This is
  `min(rawTotal, MAX_RESULT_LIMIT)` — equal to Tableau's raw total for the query when no server-side
  cap is configured, and capped to [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit)
  when one is in force. The caller's own [`limit`](#limit) does not affect this value.

To collect all custom views, the client drives pagination by incrementing
[`pageNumber`](#pagenumber) until it has gathered `totalAvailable` items.

To get the **count** of custom views matching the request, read `totalAvailable` from a single
call (for example, `pageNumber: 1`) without paging through every item.

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

### `pageNumber`

The 1-based page of results to fetch. Each page contains up to 1000 custom views. When omitted, the
first page (`1`) is returned.

To retrieve all custom views, keep incrementing `pageNumber` until you have collected
`totalAvailable` items.

Example: `2`

<hr />

### `limit`

The maximum number of custom views to return **from the requested page**. Must be less than or equal
to `1000` (the page size). Use this to fetch fewer than a full page — for example, the final partial
page a client wants. This is a client-side trim of the page and does not affect `totalAvailable`.

For the server-side overall cap across pages, see
[`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit).

Example: `600`

## Example result

```json
{
  "data": [
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
  ],
  "totalAvailable": 1
}
```
