---
sidebar_position: 1
---

# List Workbooks

Retrieves a list of workbooks.

This tool returns a single page of up to 1000 workbooks per call. The response is a flat object
of the shape `{ data, totalAvailable }` (see [Example result](#example-result)). To collect
every workbook, start at `pageNumber: 1` and increment `pageNumber` on each subsequent call
until you have collected `totalAvailable` items.

To get the **count** of workbooks matching the request, read `totalAvailable` from a single
call (for example, `pageNumber: 1`) without paging through every item.

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

### `pageNumber`

Which 1000-item page of workbooks to fetch. This is a 1-based page index (page size is fixed at
1000); when omitted it defaults to `1`. Increment `pageNumber` across calls to page through the
full result set.

Example: `2`

<hr />

### `limit`

The maximum number of workbooks to return **from the requested page**. Must be a positive
integer no greater than 1000 (the fixed page size). Use this to fetch fewer than a full page —
for example, to request a partial final page. It does not fetch across pages.

Example: `500`

See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit),
the overall cap on how many results can be paginated through across all pages.

## Example result

```json
{
  "data": [
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
  ],
  "totalAvailable": 1
}
```

The response fields are:

- `data`: the workbooks on the requested page (at most 1000, or fewer when `limit` or a server
  cap applies).
- `totalAvailable`: the number of workbooks the client should paginate up to. This is
  `min(rawTotal, MAX_RESULT_LIMIT)` — equal to Tableau's raw total for the query when no
  server-side cap is configured, and capped to [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit)
  when one is in force. Your own `limit` argument does not affect this value.
