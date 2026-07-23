---
sidebar_position: 1
---

# List Views

Retrieves a list of views.

This tool returns a single page of up to 1000 views per call. The response is a flat object:

```json
{
  "data": [ /* the views on this page (after enrichment and server-side filtering) */ ],
  "totalAvailable": 2600
}
```

- `data`: the views for the requested page (at most 1000).
- `totalAvailable`: the number of views the client should paginate up to. This is `min(rawTotal, MAX_RESULT_LIMIT)` — equal to Tableau's raw total for the query when no server-side cap is configured, and capped to [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit) when one is in force. A caller-supplied `limit` does not affect this value.

To retrieve all views, the client paginates by incrementing `pageNumber` (starting at 1) until it has collected `totalAvailable` items.

To get the **count** of views matching the request, read `totalAvailable` from a single call (for example, `pageNumber: 1`) without paging through every item.

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

### `pageNumber`

Which 1000-item page to fetch (1-based). When omitted, the first page is returned (page 1). The page size is fixed at 1000 items, so page 2 returns items 1001-2000, and so on.

Example: `2`

<hr />

### `limit`

The maximum number of views to return from the requested page. Must be `<= 1000`. Use this to fetch fewer than a full page (for example, the final partial page a client wants). This is a client-side trim applied to the single page; it does not affect `totalAvailable` in the response.

Example: `600`

See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit), the server-side overall cap across all pages.

## Example result

```json
{
  "data": [
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
      "totalViewCount": 0
    }
  ],
  "totalAvailable": 1
}
```
