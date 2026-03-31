---
sidebar_position: 5
---

# Get Custom View Image

Retrieves a PNG image for a **custom view** (a saved or personalized state of a published sheet,
including the user's filters). For a published view without a custom view, use
[Get View Image](get-view-image.md) with the view id.

## APIs called

- [Get Custom View Image](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_custom_view_image)
- [Get Custom View](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_custom_view)
  (to resolve the underlying sheet for
  [tool scoping](../../configuration/mcp-config/tool-scoping.md))
- [Get View](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_view)
  (if applicable tool scoping is enabled)

## Required arguments

### `customViewId`

The LUID of the custom view, as in the Tableau URL (e.g.
`/views/WorkbookUrl/SheetUrl/<customViewId>/<customViewName>`).

## Optional arguments

### `width` / `height`

Pixel dimensions for the rendered image (`vizWidth` / `vizHeight` in the REST API).

### `maxAge`

Maximum age in minutes for a cached image (`maxAge` query parameter). Minimum interval is one
minute.

### `viewFilters`

Map of filter field names to values; sent as `vf_<fieldname>` query parameters per
[filter query views](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm#Filter-query-views).

## Response

PNG image content (MCP `image` result with `mimeType` `image/png`).
