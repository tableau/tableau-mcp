---
sidebar_position: 3
---

# Get View

Retrieves metadata for one Tableau view, including its workbook, project, owner, tags, usage
statistics, and upstream datasources when lineage enrichment is available. It returns metadata only;
use [Render Interactive Viz](render-interactive-viz.md) for an interactive display or
[Get View Image](get-view-image.md) for a static image.

## APIs called

- [Get View](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_view)
- [Metadata API](https://help.tableau.com/current/api/metadata_api/en-us/index.html) for datasource
  lineage unless `DISABLE_METADATA_API_REQUESTS` is enabled

## Required arguments

### `viewId`

The view LUID, potentially retrieved with [List Views](list-views.md) or
[Get Workbook](../workbooks/get-workbook.md).

## Result

Returns `{ data, url }`. `data` contains the view metadata and `url` is the direct Tableau URL for
the view. Metadata API failures do not fail the call; the tool returns the REST metadata without
`upstreamDatasources` instead.
