---
sidebar_position: 3
---

# Get View Data

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Retrieves data in comma separated value (CSV) format for the specified view in a Tableau workbook,
including the user's filters. For custom views, use the [Get Custom View Data](get-custom-view-data.md)
tool with the custom view id instead.

## Access requirements

- **User/site role:** `Viewer` or higher in the MCP role hierarchy; Tableau content
  permissions and site capabilities also apply.
- **Declared registration minimum:** `Viewer`. See [role enforcement](../overview.md#role-enforcement)
  for when this filters the tool list and which roles qualify.

## APIs called

The tool talks to the **Tableau REST API** (Tableau Cloud or Server). At the MCP layer it is gated by
the `tableau:mcp:view:download` scope.

- Download the view's data as CSV.
  - `GET /api/{version}/sites/{siteId}/views/{viewId}/data` — query the view data. Issued against the
    Tableau REST API; requires the `tableau:views:download` OAuth scope.
    [Query View Data](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_view_data)
- When [tool scoping](../../configuration/mcp-config/tool-scoping.md) is enabled, verify the requested
  view is within the allowed content before downloading its data.
  - `GET /api/{version}/sites/{siteId}/views/{viewId}` — fetch the view for the bounded-context check.
    Issued against the Tableau REST API; requires the `tableau:content:read` OAuth scope (the
    tool-scoping check also reads MCP site settings with the `tableau:mcp_site_settings:read` scope).
    [Get View](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_view)

## Required arguments

### `viewId`

The ID of the view, potentially retrieved by the [List Views](list-views.md) or
[Get Workbook](../workbooks/get-workbook.md) tool. This is the view LUID from the content URL, not the
published view id.

Example: `9460abfe-a6b2-49d1-b998-39e1ebcc55ce`

## Optional arguments

### `viewFilters`
Map of view filter field names to values. `vf_` prefix for field names is optional and will be added
automatically when building the view filter query.

Example: `{ "year": "2017" }`

## Example result

```
Country/Region,State/Province,Profit Ratio,Latitude (generated),Longitude (generated)
Canada,Alberta,19.5%,53.41,-114.42
Canada,British Columbia,4.2%,54.9464,-125.1024
Canada,Manitoba,8.2%,55.0085,-97.1771
```

## Related

- [`get-custom-view-data`](get-custom-view-data.md) — retrieve CSV data for a custom view by custom view id
- [`get-view-image`](get-view-image.md) — retrieve an image of a view instead of its data
- [`list-views`](list-views.md) — find the `viewId` for a view in a workbook

{/* tool-details */}
## Response behavior

The result shape depends on the Tableau REST API version.

### Tableau REST API 3.30 and later

The tool requests allData and returns a JSON array containing every sheet part exported by Tableau,
in the response order. Each successful sheet contains its name, columns, rows, and an `OK` status.
An unavailable sheet is returned with an `ERROR` status, its error detail when available, and empty
columns and rows; it does not prevent healthy sheets from being returned.

For valid multipart response parts, the tool does not select, synthesize a manifest for, locally
filter, or reject sheets. Duplicate sheet names are returned as distinct parts. The allData request
is blocking and returns each sheet in full, so very large responses can exceed practical MCP
context limits. Request-level failures and malformed multipart responses fail the whole tool call;
they do not return partial results or fall back to the legacy CSV endpoint.

```json
[
  {
    "sheetName": "Sales",
    "columns": ["Region", "Sales"],
    "rows": [["West", "100"]],
    "sheetStatus": "OK"
  },
  {
    "sheetName": "Profit",
    "columns": [],
    "rows": [],
    "sheetStatus": "ERROR",
    "errorDetail": "The worksheet is unavailable."
  }
]
```

### Tableau REST API versions below 3.30

The tool uses Query View Data and returns CSV for the requested worksheet, or the first worksheet
when the requested view is a dashboard. It returns one of two result shapes:

- **`MCP_S3_BUCKET` unset (default):** returns the CSV as a single JSON-encoded text string
  (`JSON.stringify(csv)`), with newlines escaped as `\n`.
- **`MCP_S3_BUCKET` set with `view-data-file-mode` enabled:** returns a `resource_link` with a
  short-lived presigned URL to the CSV file in S3, instead of inlining the data. If the feature is
  disabled or the upload fails, the tool returns the CSV inline.

## Example legacy result (default)

```
"Country/Region,State/Province,Profit Ratio,Latitude (generated),Longitude (generated)\nCanada,Alberta,19.5%,53.41,-114.42\nCanada,British Columbia,4.2%,54.9464,-125.1024\nCanada,Manitoba,8.2%,55.0085,-97.1771\n"
```

## Example legacy result (S3 mode)

```json
{
  "type": "resource_link",
  "uri": "https://example-bucket.s3.amazonaws.com/...presigned...",
  "name": "view-data.csv",
  "mimeType": "text/csv",
  "description": "View data (CSV) stored in S3. This is a short-lived presigned URL."
}
```

## Data and limits

Returned data reflects the view after Tableau applies the view filters supplied through
`viewFilters`. It does not return direct datasource rows.

The tool has no local cache and does not expose an API cache-age control. Streaming, pagination,
and direct VizQL Data Service fallback are not supported by this tool.
{/* /tool-details */}
