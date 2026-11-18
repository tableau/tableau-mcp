---
sidebar_position: 1
---

# List Views

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Retrieves a list of views on a Tableau site, including metadata such as each view's name, owner, and
the workbook it belongs to. Supports optional `filter` expressions for precise, flexible view
discovery.

## APIs called

This tool talks to the **Tableau REST API** (Tableau Cloud or Server) to list the site's views, then
enriches each view with lineage metadata from the **Metadata API** (GraphQL). The MCP-layer OAuth
gate requires the `tableau:content:read` OAuth scope plus `tableau:mcp_site_settings:read` to read
per-site MCP configuration overrides when MCP site settings are enabled.

- **List the site's views.** Retrieves views with usage statistics, paginating automatically until
  all views are returned or the `limit` argument is reached.
  - `GET /api/{version}/sites/{siteId}/views` — retrieve a page of views for the site. Issued against
    the Tableau REST API; requires the `tableau:content:read` OAuth scope.
    [Query Views for Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_views_for_site)
- **Enrich views with lineage metadata.** Looks up upstream lineage for the returned views to
  attach datasource context. Skipped when no views are found or when
  [`DISABLE_METADATA_API_REQUESTS`](../../configuration/mcp-config/env-vars.md#disable_metadata_api_requests)`=true`;
  if the lookup fails, the tool logs a warning and returns the views without lineage enrichment.
  - `POST /api/metadata/graphql` — query upstream lineage for the returned views. Issued against the
    Metadata API (GraphQL); requires the `tableau:content:read` OAuth scope.
    [Metadata API](https://help.tableau.com/current/api/metadata_api/en-us/index.html)

## Optional arguments

### `filter`

A
[filter expression](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm)
as defined in the
[Tableau REST API Views filter fields](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm#views).

Example: `name:eq:Overview`

<hr />

### `pageNumber`

Which 1000-item page to fetch (1-based, default 1).

### `limit`
The maximum number of views to return. The tool will return at most this many views.

Example: `2000`

See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit)

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

{/* tool-details */}
## Worked example

The response fields are:

- `data`: the views on the requested page (at most 1000, or fewer when `limit` or a server cap
  applies).
- `totalAvailable`: the number of views available for pagination, never more than a server cap. Your
  own `limit` argument does not affect this value.
- `mcp.resultInfo`: present only when a server cap hides views:
  `{ returnedCount, truncated: true, truncationReason: "admin-cap" }`. `returnedCount` is the
  number of items in `data`.

## Arguments no longer accepted

These arguments were described on an earlier page and are not accepted by the current tool.

### `pageSize`

The value of the `page-size` argument provided to the
[Query Views for Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_views_for_site)
REST API. The tool automatically performs pagination and will repeatedly call the REST API until
either all views are retrieved or the `limit` argument has been reached. The `pageSize` argument
will determine how many views to return in each call. You may want to provide a larger value if you
know in advance that you have more than 100 views to retrieve.

Example: `1000`

<hr />
{/* /tool-details */}
