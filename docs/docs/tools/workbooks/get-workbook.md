---
sidebar_position: 2
---

# Get Workbook

Retrieves information on a workbook, including information about the views contained in the workbook
and their usage statistics.

## APIs called

- [Query Workbook](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbook)
- [Query Views for Workbook](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_views_for_workbook)

## Required arguments

### `workbookId`

The ID of the workbook, potentially retrieved by the [List Workbooks](list-workbooks.md) tool.

Example: `222ea993-9391-4910-a167-56b3d19b4e3b`

## Example result

```json
{
  "id": "222ea993-9391-4910-a167-56b3d19b4e3b",
  "name": "Superstore",
  "webpageUrl": "https://10ax.online.tableau.com/#/site/mcp-test/workbooks/1412200",
  "contentUrl": "Superstore",
  "project": {
    "name": "Samples",
    "id": "cbec32db-a4a2-4308-b5f0-4fc67322f359"
  },
  "showTabs": true,
  "defaultViewId": "9460abfe-a6b2-49d1-b998-39e1ebcc55ce",
  "tags": {},
  "views": {
    "view": [
      {
        "id": "9460abfe-a6b2-49d1-b998-39e1ebcc55ce",
        "name": "Overview",
        "createdAt": "2025-09-02T23:25:58Z",
        "updatedAt": "2025-09-02T23:25:58Z",
        "tags": {},
        "usage": {
          "totalViewCount": 165
        }
      }
  }
}
```
