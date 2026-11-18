---
sidebar_position: 2
---

# Get Workbook

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Retrieves information about a single workbook, including the views it contains and their usage
statistics. When Metadata API access is enabled, the result is also enriched with the workbook's
upstream data-source lineage.

## Access requirements

- **User/site role:** `Viewer` or higher in the MCP role hierarchy; Tableau content
  permissions and site capabilities also apply.
- **Declared registration minimum:** `Viewer`. See [role enforcement](../overview.md#role-enforcement)
  for when this filters the tool list and which roles qualify.

## APIs called

This tool reads from the Tableau REST API (Tableau Cloud or Server) and, unless disabled, enriches
the result with the Tableau Metadata API (GraphQL). The MCP-layer OAuth scope is
`tableau:mcp:workbook:read`; across its calls it requires the `tableau:content:read` and
`tableau:mcp_site_settings:read` OAuth scopes.

- Confirm the caller is allowed to access the requested workbook before returning it, honoring any
  configured content bounded-context / allow-list. Issued against the Tableau REST API; requires the
  `tableau:content:read` and `tableau:mcp_site_settings:read` OAuth scopes. This check may itself
  read the workbook via the Query Workbook call below.
- Retrieve the workbook's metadata (name, project, tags, default view, and its views). Issued against
  the Tableau REST API; requires the `tableau:content:read` OAuth scope.
  - `GET /api/{version}/sites/{siteId}/workbooks/{workbookId}` — return the workbook's details. [Query Workbook](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbook)
- Fetch each view's usage statistics and merge them into the workbook's views. Issued against the
  Tableau REST API; requires the `tableau:content:read` OAuth scope.
  - `GET /api/{version}/sites/{siteId}/workbooks/{workbookId}/views?includeUsageStatistics=true` — return the workbook's views with usage counts. [Query Views for Workbook](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_views_for_workbook)
- Enrich the workbook with its upstream data-source lineage, unless [`DISABLE_METADATA_API_REQUESTS`](../../configuration/mcp-config/env-vars.md#disable_metadata_api_requests)`=true`. Issued against the Tableau Metadata API (GraphQL); requires the `tableau:content:read` OAuth scope.
  - `POST /api/metadata/graphql` — run a GraphQL query for the workbook's upstream data sources. [Metadata API](https://help.tableau.com/current/api/metadata_api/en-us/index.html)

:::note[Lineage enrichment]
The lineage step is best-effort: if the Metadata API request fails, the tool logs a warning and
returns the workbook without lineage rather than failing the request.
:::

## Required arguments

### `workbookId`

The ID of the workbook, potentially retrieved by the [List Workbooks](list-workbooks.md) tool.

Example: `222ea993-9391-4910-a167-56b3d19b4e3b`

## Example result

```json
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
  "tags": {},
  "views": {
    "view": [
      {
        "id": "9460abfe-a6b2-49d1-b998-39e1ebcc55ce",
        "name": "Overview",
        "createdAt": "2025-09-02T23:25:58Z",
        "updatedAt": "2025-09-02T23:25:58Z",
        "tags": {},
        "totalViewCount": 165
      }
    ]
  }
}
```

## Related

- [`list-workbooks`](list-workbooks.md) — list the workbooks on a site to obtain a `workbookId`
