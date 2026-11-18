---
sidebar_position: 4
---

# List Custom Views

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Retrieves a list of custom views for a specified Tableau workbook, including their metadata such as
name, owner, and the view they are found in. Supports optional filtering via `field:operator:value`
expressions (e.g. `viewId:eq:<viewId>`) for precise, flexible custom view discovery. Use this tool
when a user requests to list, search, or filter Tableau custom views for a workbook.

## APIs called

This tool talks to the **Tableau REST API** (Tableau Cloud or Server) to look up the workbook and
list its custom views. The MCP-layer OAuth gate requires `tableau:content:read` (cited per operation
below) plus `tableau:mcp_site_settings:read` to read per-site MCP configuration overrides (e.g.
[`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit)) when MCP site
settings are enabled.

- **Look up the workbook.** Resolves the workbook named by `workbookId` and confirms the caller is
  allowed to query it, so custom views for a disallowed or non-existent workbook are rejected before
  any custom-view call is made.
  - `GET /api/{version}/sites/{siteId}/workbooks/{workbookId}` — query the workbook. Issued against
    the Tableau REST API; requires the `tableau:content:read` OAuth scope.
    [Get Workbook](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbook)
- **List the workbook's custom views.** Returns the custom views for the resolved workbook, applying
  the `filter` expression when provided. The tool paginates automatically, repeatedly calling the
  endpoint until all matching custom views are retrieved or the `limit` is reached.
  - `GET /api/{version}/sites/{siteId}/customviews` — list the site's custom views, scoped to the
    workbook. Issued against the Tableau REST API; requires the `tableau:content:read` OAuth scope.
    [List Custom Views](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#list_custom_views)

## Required arguments

### `workbookId`

The ID of the workbook containing the custom view, potentially retrieved by the
[List Workbooks](../workbooks/list-workbooks.md) tool.

Example: `222ea993-9391-4910-a167-56b3d19b4e3b`

## Optional arguments

### `filter`

A
[filter expression](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm)
using only these supported Tableau REST API Custom Views filter fields:

- `viewId:eq:<viewId>`
- `ownerId:eq:<ownerId>`

Example: `viewId:eq:9460abfe-a6b2-49d1-b998-39e1ebcc55ce`

:::note[Filter behavior]
The tool always includes `workbookId` in the filter expression based on the required
[`workbookId`](#workbookid) argument. Including the `workbookId` field in the filter will be
ignored.
:::

<hr />

### `limit`

The maximum number of custom views to return. The tool will return at most this many custom views.
The effective cap is the tighter of this argument and the server-configured
[`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit).

Example: `2000`

See also: [`MAX_RESULT_LIMIT`](../../configuration/mcp-config/env-vars.md#max_result_limit)

## Notes and caveats

- The set of custom views that can be returned may be limited by the server configuration. When an
  allow-list of views is configured, custom views whose underlying view is outside it are filtered
  out, so the tool can return an empty list even though custom views exist for the workbook.

## Example result

```json
[
  {
    "id": "1db3a121-51ac-4435-b533-3053e698dfc8",
    "name": "My Custom View",
    "createdAt": "2026-03-26T17:34:21Z",
    "updatedAt": "2026-03-31T22:06:29Z",
    "lastAccessedAt": "2026-03-31T22:06:29Z",
    "shared": false,
    "view": {
      "id": "9460abfe-a6b2-49d1-b998-39e1ebcc55ce",
      "name": "Overview"
    },
    "workbook": {
      "id": "222ea993-9391-4910-a167-56b3d19b4e3b",
      "name": "Superstore"
    },
    "owner": {
      "id": "bbdee366-4a50-4c2c-a5c8-746da5b64483",
      "name": "andrew.young@tableau.com"
    }
  }
]
```

## Related

- [`get-custom-view-data`](get-custom-view-data.md) — retrieve the underlying data of a single custom view
- [`get-custom-view-image`](get-custom-view-image.md) — retrieve a PNG image of a single custom view
- [`list-workbooks`](../workbooks/list-workbooks.md) — find the `workbookId` for a workbook

{/* tool-details */}
## Arguments no longer accepted

These arguments were described on an earlier page and are not accepted by the current tool.

### `pageSize`

The value of the `page-size` argument provided to the
[List Custom Views](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#list_custom_views)
REST API. The tool automatically performs pagination and will repeatedly call the REST API until
either all custom views are retrieved or the `limit` argument has been reached. The `pageSize`
argument will determine how many custom views to return in each call. You may want to provide a
larger value if you know in advance that you have more than 100 custom views to retrieve.

Example: `1000`

<hr />
{/* /tool-details */}
