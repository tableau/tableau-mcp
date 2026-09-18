---
sidebar_position: 3
---

# Get View Data

Retrieves data for the specified view in a Tableau workbook.

## APIs called

- [Query View Data](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_view_data)
  for Tableau REST API versions below 3.30
- `GET /sites/{siteId}/views/{viewId}/allData` for Tableau REST API version 3.30 and later
- [Get View](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_view)
  (if applicable [tool scoping](../../configuration/mcp-config/tool-scoping.md) is enabled)

## Required arguments

### `viewId`

The ID of the view, potentially retrieved by the [List Views](list-views.md) or
[Get Workbook](../workbooks/get-workbook.md) tool.

Example: `9460abfe-a6b2-49d1-b998-39e1ebcc55ce`

## Optional arguments

### `viewFilters`

Map of view filter field names to values. `vf_` prefix for field names is optional and will be added
automatically when building the view filter query.

Example: `{ "year": "2017" }`

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
