---
sidebar_position: 7
---

# Get View

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Retrieves information about the specified view, including its upstream datasources, workbook
information, project details, owner, tags, and usage statistics. To retrieve the view's data or an
image instead of its metadata, use [Get View Data](get-view-data.md) or
[Get View Image](get-view-image.md).

## APIs called

This tool talks to the **Tableau REST API** (Tableau Cloud or Server) to fetch the view, then
enriches it with upstream lineage from the **Metadata API** (GraphQL). The MCP-layer OAuth gate
requires the `tableau:content:read` OAuth scope plus `tableau:mcp_site_settings:read` to read
per-site MCP configuration overrides when MCP site settings are enabled.

- **Fetch the view with usage statistics.** Retrieves the view identified by `viewId`. This call
  also serves the [tool scoping](../../configuration/mcp-config/tool-scoping.md) bounded-context
  check — when tool scoping is enabled, the view must be within the allowed content or the tool
  refuses the request.
  - `GET /api/{version}/sites/{siteId}/views/{viewId}` — retrieve the view (with usage statistics).
    Issued against the Tableau REST API; requires the `tableau:content:read` OAuth scope (the
    tool-scoping check also reads MCP site settings with the `tableau:mcp_site_settings:read`
    scope).
    [Get View](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_view)
- **Enrich the view with lineage metadata.** Looks up the view's upstream datasources to attach
  datasource context. Skipped when
  [`DISABLE_METADATA_API_REQUESTS`](../../configuration/mcp-config/env-vars.md#disable_metadata_api_requests)`=true`;
  if the lookup fails, the tool logs a warning and returns the view without lineage enrichment.
  - `POST /api/metadata/graphql` — query the view's upstream lineage. Issued against the Metadata
    API (GraphQL); requires the `tableau:content:read` OAuth scope.
    [Metadata API](https://help.tableau.com/current/api/metadata_api/en-us/index.html)

## Required arguments

### `viewId`

The ID of the view, potentially retrieved by the [List Views](list-views.md) or
[Get Workbook](../workbooks/get-workbook.md) tool. This is the view LUID from the content URL, not
the published view id.

Example: `9460abfe-a6b2-49d1-b998-39e1ebcc55ce`

## Example result

```json
{
  "data": {
    "id": "9460abfe-a6b2-49d1-b998-39e1ebcc55ce",
    "name": "Overview",
    "contentUrl": "Superstore/sheets/Overview",
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
      "totalViewCount": 42
    },
    "upstreamDatasources": [
      {
        "luid": "2d935df8-fe7e-4fd8-bb14-35eb4ba31d45",
        "name": "Superstore"
      }
    ]
  },
  "url": "https://my-tableau-server.example.com/#/site/my-site/views/Superstore/Overview"
}
```

:::note[Lineage enrichment]
The `upstreamDatasources` array is populated from the Metadata API. It is omitted when metadata
requests are disabled, when the lineage lookup fails, or when the view has no discoverable upstream
datasources.
:::

## Related

- [`get-view-data`](get-view-data.md) — retrieve the view's data as CSV instead of its metadata
- [`get-view-image`](get-view-image.md) — retrieve an image of the view instead of its metadata
- [`list-views`](list-views.md) — find the `viewId` for a view on the site
- [`get-workbook`](../workbooks/get-workbook.md) — list the views that belong to a workbook
