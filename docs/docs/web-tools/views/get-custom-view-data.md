---
sidebar_position: 5
---

# Get Custom View Data

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Retrieves comma-separated value (CSV) data for a Tableau custom view — a saved or personalized
state of a published sheet, including the user's filters. Pass the custom view LUID (from the
content URL), not the published view id. For a published view without a custom view, use
[Get View Data](get-view-data.md) with the view id instead.

## Access requirements

- **User/site role:** `Viewer` or higher in the MCP role hierarchy; Tableau content
  permissions and site capabilities also apply.
- **Declared registration minimum:** `Viewer`. See [role enforcement](../overview.md#role-enforcement)
  for when this filters the tool list and which roles qualify.

## APIs called

Talks to the Tableau REST API (Tableau Cloud or Server). Gated by the `tableau:mcp:view:download`
MCP scope; across the operations below it needs the `tableau:views:download` and
`tableau:content:read` OAuth scopes (plus `tableau:mcp_site_settings:read`).

- Download the custom view rendered as CSV.
  - `GET /api/{version}/sites/{siteId}/customviews/{customViewId}/data` — return the custom view's
    data as CSV, applying any `viewFilters`. Issued against the Tableau REST API; requires the
    `tableau:views:download` OAuth scope. [Get Custom View Data](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_custom_view_data)
- When [tool scoping](../../configuration/mcp-config/tool-scoping.md) is enabled, resolve the custom
  view to its underlying published view and check it against the configured allow-lists.
  - `GET /api/{version}/sites/{siteId}/customviews/{customViewId}` — resolve the underlying view id.
    Issued against the Tableau REST API; requires the `tableau:content:read` OAuth scope (plus
    `tableau:mcp_site_settings:read`). [Get Custom View](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_custom_view)
  - `GET /api/{version}/sites/{siteId}/views/{viewId}` — verify the resolved view is within the
    allowed projects, workbooks, views, and tags. Issued against the Tableau REST API; requires the
    `tableau:content:read` OAuth scope (plus `tableau:mcp_site_settings:read`). [Get View](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_view)

## Required arguments

### `customViewId`

The LUID of the custom view, potentially retrieved by the [List Custom Views](list-custom-views.md)
tool. This is the custom view LUID from the content URL, not the published view id.

#### Example

```json
{ "customViewId": "1db3a121-51ac-4435-b533-3053e698dfc8" }
```

## Optional arguments

### `viewFilters`
Map of view filter field names to values. The `vf_` prefix for field names is optional and will be
added automatically when building the view filter query.

#### Example

```json
{ "viewFilters": { "year": "2017" } }
```

## Example result

```
Country/Region,State/Province,Profit Ratio,Latitude (generated),Longitude (generated)
Canada,Ontario,26.8%,50.94,-84.75
```

## Related

- [`get-view-data`](get-view-data.md) — download CSV data for a published view by its view id
- [`get-custom-view-image`](get-custom-view-image.md) — render a custom view as an image
- [`list-custom-views`](list-custom-views.md) — find custom view LUIDs on the site

{/* tool-details */}
## Response behavior

The tool returns one of two result shapes:

- **`MCP_S3_BUCKET` unset (default):** returns the CSV as a single JSON-encoded text string
  (`JSON.stringify(csv)`), with newlines escaped as `\n`.
- **`MCP_S3_BUCKET` set:** returns a `resource_link` with a short-lived presigned URL to the CSV
  file in S3, instead of inlining the data.

## Example result (default)

```
"Country/Region,State/Province,Profit Ratio,Latitude (generated),Longitude (generated)\nCanada,Ontario,26.8%,50.94,-84.75\n"
```

## Example result (S3 mode)

```json
{
  "type": "resource_link",
  "uri": "https://example-bucket.s3.amazonaws.com/...presigned...",
  "name": "view-data.csv",
  "mimeType": "text/csv",
  "description": "View data (CSV) stored in S3. This is a short-lived presigned URL."
}
```
{/* /tool-details */}
