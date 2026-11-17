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

To get the **count** of data sources matching the request, read `totalAvailable` from a single call
(for example, with `limit: 1`) without paging through every item; your own `limit` does not change
it. When a server cap
([`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit) or
[`MAX_RESULT_LIMITS`](../../configuration/mcp-config/env-vars.md#max_result_limits)) hides some data
sources, `totalAvailable` stops at the cap and the response includes `mcp.resultInfo` with
`truncationReason: "admin-cap"`. More data sources exist than `totalAvailable` shows: you can page
up to `totalAvailable`, and you need a `filter` to reach the rest.

## APIs called

- [Query Data Sources](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_sources)

## Optional arguments

### `tagLabels`

Exact, case-sensitive published-data-source tags to search for. `["Sales"]` matches that tag;
`["Sales", "Finance"]` matches ANY listed tag (OR). Duplicates are removed without changing case or
Unicode. Other `filter` fields are ANDed with the tag condition, but a raw `tags` clause cannot be
combined with `tagLabels`. This is not an all-tags AND search.

Tool limits: 1–50 labels, each at most 256 UTF-16 code units. No `&`, comma, brackets,
percent-escape sequences, ASCII controls or surrounding whitespace. See
[Search Content by Tag](../content/search-content-by-tag.md) for API limitations and pagination.


### `filter`

A
[filter expression](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm)
as defined in the
[Tableau REST API Data Sources filter fields](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm#datasources).

Example: `name:eq:Project Views`

<hr />

### `limit`

The maximum number of data sources to return **from the requested page**. Must be a positive
integer no greater than 1000 (the fixed page size). Use this to fetch fewer than a full page —
for example, to request a partial final page. It does not fetch across pages.

Example: `600`

See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit) and
[`MAX_RESULT_LIMITS`](../../configuration/mcp-config/env-vars.md#max_result_limits), the overall cap
on how many results can be paginated through across all pages.

<hr />

### `pageNumber`

Which 1000-item page of data sources to fetch. This is a 1-based page index (page size is
fixed at 1000); when omitted it defaults to `1`. Increment `pageNumber` across calls to page
through the full result set.

When a server-side [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit)
is configured, only pages that fall within that cap are reachable. For example, with a limit of
`2700` the highest page you can request is `3` (page 3 returns the final 700 items). Requesting a
higher page returns an error describing the valid page range rather than an empty result.

Example: `2`

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
- `totalAvailable`: the number of data sources available for pagination, never more than a server
  cap. Your own `limit` argument does not affect this value.
- `mcp.resultInfo`: present only when a server cap hides data sources:
  `{ returnedCount, truncated: true, truncationReason: "admin-cap" }`. `returnedCount` is the
  number of items in `data`.
