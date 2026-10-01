---
sidebar_position: 2
---

# Get Workbook

Retrieves information on a workbook, including information about the views contained in the workbook
and their usage statistics, and the workbook's backing datasources.

The response's `upstreamDatasources` list each data source the workbook depends on. An entry's
`queryability.isQueryable` is `true` when the calling user can query that data source with the
[Query Datasource](../data-qna/query-datasource.md) tool, and `false` when they cannot — in which
case `queryability.reason` explains why. The `queryability` object is omitted entirely when
queryability could not be determined. When a data source is not queryable, its `owner` (or
`publishedParent.owner`) identifies who to contact to request access.

Related tools: [Download Workbook](download-workbook.md), [List Workbooks](list-workbooks.md)

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
  "owner": {
    "id": "a5155ff7-de06-4ddd-ad90-55e3b3bf0d1c",
    "username": "alice",
    "displayName": "Alice Smith"
  },
  "views": {
    "view": [
      {
        "id": "9460abfe-a6b2-49d1-b998-39e1ebcc55ce",
        "name": "Overview",
        "createdAt": "2025-09-02T23:25:58Z",
        "updatedAt": "2025-09-02T23:25:58Z",
        "tags": {},
        "totalViewCount": 165
      }
    ]
  },
  "upstreamDatasources": [
    {
      "luid": "6b3f0d1c-de06-4ddd-ad90-a5155ff755e3",
      "name": "Superstore Datasource",
      "datasourceType": "published",
      "owner": {
        "id": "a5155ff7-de06-4ddd-ad90-55e3b3bf0d1c",
        "username": "alice",
        "displayName": "Alice Smith"
      },
      "queryability": {
        "isQueryable": true
      }
    },
    {
      "luid": "d1c6b3f0-ad90-4ddd-de06-55e3b3bf755e",
      "name": "Embedded Extract",
      "datasourceType": "embedded",
      "queryability": {
        "isQueryable": false,
        "reason": "The user does not have permission to query this data source."
      }
    }
  ]
}
```
