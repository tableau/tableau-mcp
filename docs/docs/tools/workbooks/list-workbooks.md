---
sidebar_position: 1
---

# List Workbooks

Retrieves a list of workbooks.

This tool returns a single **1000-item page** per call. Use [`pageNumber`](#pagenumber) to
select which page to fetch. The response is a flat object:

```json
{
  "data": [ /* up to 1000 workbooks on this page */ ],
  "totalAvailable": 2600
}
```

- `data` — the workbooks on the requested page (at most 1000).
- `totalAvailable` — the number of workbooks the client should paginate up to. This is
  `min(rawTotal, MAX_RESULT_LIMIT)` — equal to the raw total Tableau reports for the query when no
  server-side cap is configured, and capped to [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit)
  when one is in force. A caller-provided [`limit`](#limit) does not affect this value.

To collect the full result set, the **client** paginates by incrementing `pageNumber` (starting at
1) until it has collected `totalAvailable` items.

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

Which 1000-item page to fetch (1-based). When omitted, page 1 is returned. Each page contains up to
1000 workbooks. Increment `pageNumber` to page through the full result set until you have collected
`totalAvailable` items (see the response shape above).

Example: `2`

<hr />

### `limit`

The maximum number of workbooks to return **from the requested page**. Must be `<= 1000`. Use this
to fetch fewer than a full page — for example, to request the final partial page a client wants.
A caller-provided `limit` does not affect `totalAvailable`.

This is distinct from the server-side overall cap
[`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit), which limits the
total number of workbooks available across all pages and caps `totalAvailable` accordingly.

Example: `500`

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
