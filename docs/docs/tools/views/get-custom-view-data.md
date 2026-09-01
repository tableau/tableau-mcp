---
sidebar_position: 5
---

# Get Custom View Data

Retrieves data in comma separated value (CSV) format for the specified custom view in a Tableau
workbook.

## APIs called

- [Get Custom View Data](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_custom_view_data)
- [Get Custom View](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_custom_view)
  and
  [Get View](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_view)
  (if applicable [tool scoping](../../configuration/mcp-config/tool-scoping.md) is enabled)

## Required arguments

### `customViewId`

The ID of the custom view, potentially retrieved by the [List Custom Views](list-custom-views.md)
tool.

Example: `1db3a121-51ac-4435-b533-3053e698dfc8`

## Optional arguments

### `viewFilters`

Map of view filter field names to values. `vf_` prefix for field names is optional and will be added
automatically when building the view filter query.

Example: `{ "year": "2017" }`

## Response behavior

The tool returns one of two result shapes:

- **Blob storage not configured/enabled (default):** returns the CSV as a single JSON-encoded text
  string (`JSON.stringify(csv)`), with newlines escaped as `\n`.
- **Blob storage configured/enabled:** returns a `resource_link` with a URL to the CSV file in
  blob storage, instead of inlining the data.

## Example result (default)

```
"Country/Region,State/Province,Profit Ratio,Latitude (generated),Longitude (generated)\nCanada,Ontario,26.8%,50.94,-84.75\n"
```

## Example result (blob storage mode)

```json
{
  "type": "resource_link",
  "uri": "https://example-bucket.s3.amazonaws.com/...presigned...",
  "name": "view-data.csv",
  "mimeType": "text/csv",
  "description": "View data (CSV) stored in blob storage."
}
```
