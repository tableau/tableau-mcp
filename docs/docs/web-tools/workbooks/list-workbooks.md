---
sidebar_position: 1
---

# List Workbooks

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Retrieves a list of workbooks on a Tableau site, including their metadata such as name, description,
and information about the views contained in each workbook. Supports optional filtering via
`field:operator:value` expressions (e.g. `name:eq:Superstore`) for precise, flexible workbook
discovery. Use this tool when a user requests to list, search, or filter Tableau workbooks on a site.

## APIs called

This tool talks to the **Tableau REST API** (Tableau Cloud or Server) to list the site's workbooks,
then optionally enriches each result with datasource lineage from the **Metadata API** (GraphQL).
The MCP-layer OAuth gate requires `tableau:content:read` (cited per operation below) plus
`tableau:mcp_site_settings:read` to read per-site MCP configuration overrides (e.g.
[`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit),
[`DISABLE_METADATA_API_REQUESTS`](../../configuration/mcp-config/env-vars.md#disable_metadata_api_requests))
when MCP site settings are enabled.

- **List the site's workbooks.** Returns the workbooks visible to the caller, applying the `filter`
  expression when provided. The tool paginates automatically, repeatedly calling the endpoint until
  all matching workbooks are retrieved or the `limit` is reached.
  - `GET /api/{version}/sites/{siteId}/workbooks` — query the workbooks for the site. Issued against
    the Tableau REST API; requires the `tableau:content:read` OAuth scope.
    [Query Workbooks for Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbooks_for_site)
- **Enrich workbooks with datasource lineage.** Best-effort follow-up that adds published-datasource
  lineage metadata to the listed workbooks. Skipped when there are no workbooks or when metadata
  requests are disabled via
  [`DISABLE_METADATA_API_REQUESTS`](../../configuration/mcp-config/env-vars.md#disable_metadata_api_requests).
  - `POST /api/metadata/graphql` — query workbook-to-datasource lineage. Issued against the Metadata
    API (GraphQL); requires the `tableau:content:read` OAuth scope.
    [Tableau Metadata API](https://help.tableau.com/current/api/metadata_api/en-us/index.html)

## Optional arguments

### `filter`

A
[filter expression](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm)
as defined in the
[Tableau REST API Workbooks filter fields](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm#workbooks).
Combine multiple expressions by separating them with commas.

Example: `name:eq:Superstore`

#### Supported filter fields and operators

| Field             | Operators            |
|-------------------|----------------------|
| createdAt         | eq, gt, gte, lt, lte |
| contentUrl        | eq, in               |
| displayTabs       | eq                   |
| favoritesTotal    | eq, gt, gte, lt, lte |
| hasAlerts         | eq                   |
| hasExtracts       | eq                   |
| name              | eq, in               |
| ownerDomain       | eq, in               |
| ownerEmail        | eq, in               |
| ownerName         | eq, in               |
| projectName       | eq, in               |
| sheetCount        | eq, gt, gte, lt, lte |
| size              | eq, gt, gte, lt, lte |
| subscriptionTotal | eq, gt, gte, lt, lte |
| tags              | eq, in               |
| updatedAt         | eq, gt, gte, lt, lte |

<hr />

### `pageNumber`

Which 1000-item page to fetch (1-based, default 1).

### `limit`
The maximum number of workbooks to return. The tool will return at most this many workbooks. The
effective cap is the tighter of this argument and the server-configured
[`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit).

Example: `2000`

See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit)

## Notes and caveats

- The set of workbooks that can be returned may be limited by the server configuration. When an
  allow-list of projects, workbooks, or tags is configured, results outside it are filtered out, so
  the tool can return an empty list even though workbooks exist on the site.
- Lineage enrichment is best-effort: if the Metadata API request fails, the tool logs a warning and
  returns the workbooks without the added lineage metadata rather than failing the call.

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

## Related

- [`get-workbook`](get-workbook.md) — retrieve a single workbook's details and view usage statistics

{/* tool-details */}
## Worked example

The response fields are:

- `data`: the workbooks on the requested page (at most 1000, or fewer when `limit` or a server
  cap applies).
- `totalAvailable`: the number of workbooks available for pagination, never more than a server cap.
  Your own `limit` argument does not affect this value.
- `mcp.resultInfo`: present only when a server cap hides workbooks:
  `{ returnedCount, truncated: true, truncationReason: "admin-cap" }`. `returnedCount` is the
  number of items in `data`.

## Arguments no longer accepted

These arguments were described on an earlier page and are not accepted by the current tool.

### `pageSize`

The value of the `page-size` argument provided to the
[Query Workbooks for Site](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbooks_for_site)
REST API. The tool automatically performs pagination and will repeatedly call the REST API until
either all workbooks are retrieved or the `limit` argument has been reached. The `pageSize` argument
determines how many workbooks to return in each call. You may want to provide a larger value if you
know in advance that you have more than 100 workbooks to retrieve.

Example: `1000`

<hr />
{/* /tool-details */}
