---
sidebar_position: 3
---

# Get View Data

Retrieves data in comma separated value (CSV) format for the specified view in a Tableau workbook.

## APIs called

- [Query View Data](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_view_data)
- [Get View](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_view)
  (if workbook or project [tool scoping](../../configuration/mcp-config/tool-scoping.md) is enabled)

## Required arguments

### `viewId`

The ID of the view, potentially retrieved by the [List Views](list-views.md) or
[Get Workbook](../workbooks/get-workbook.md) tool.

Example: `9460abfe-a6b2-49d1-b998-39e1ebcc55ce`

## Example result

```
Country/Region,State/Province,Profit Ratio,Latitude (generated),Longitude (generated)
Canada,Alberta,19.5%,53.41,-114.42
Canada,British Columbia,4.2%,54.9464,-125.1024
Canada,Manitoba,8.2%,55.0085,-97.1771
```
