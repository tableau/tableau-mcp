---
sidebar_position: 4
---

# Get Custom View Data

Retrieves data in comma separated value (CSV) format for a **custom view** (a saved or personalized
state of a published sheet, including the user's filters). For the default published sheet only, use
[Get View Data](get-view-data.md) with the view id.

## APIs called

- [Get Custom View Data](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_custom_view_data)
- [Get Custom View](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_custom_view)
  (to resolve the underlying sheet for
  [tool scoping](../../configuration/mcp-config/tool-scoping.md))
- [Get View](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_view)
  (if applicable tool scoping is enabled)

## Required arguments

### `customViewId`

The LUID of the custom view. This appears in the Tableau URL for a saved view (e.g. the
`<customViewId>` in `/views/WorkbookUrl/SheetUrl/<customViewId>/<customViewName>`), not the
published view id returned by List Views for the sheet alone.

Example: `f69e71d6-8a91-4f46-bea7-dc7d2e124ab7`

## Optional arguments

### `viewFilters`

Optional map of field names to values, sent as `vf_<fieldname>` query parameters per
[filter query views](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm#Filter-query-views).

## Example result

Same CSV shape as [Get View Data](get-view-data.md), reflecting the custom view's filters.
