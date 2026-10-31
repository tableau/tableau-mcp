---
sidebar_position: 20
---

# List Workbook Revisions

Lists one page of a workbook's revision history. Site revision history must be enabled. The caller needs ExplorerCanPublish or higher and the workbook/project permissions required by Tableau for revision access.

## APIs called

- [Get Workbook Revisions](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#get_workbook_revisions)
- Query Workbook when tool scoping requires an eligibility check.

## Required Tableau API scopes

`tableau:content:read` and `tableau:mcp_site_settings:read`.

## Arguments

| Argument | Required | Description |
| --- | --- | --- |
| `workbookId` | Yes | Workbook LUID from List Workbooks. |
| `pageSize` | No | 1–1000; default 100. |
| `pageNumber` | No | Page number starting at 1; default 1. |

## Response behavior

Returns `pagination` and `revisions`. Revision numbers are numeric. Author information can be absent after a user is deleted. Current/deleted markers are preserved when returned by Tableau. A page is not the complete history unless the pagination metadata establishes that.

Use [Download Workbook Revision](download-workbook-revision.md) for a past revision. Use [Download Workbook](download-workbook.md) for the current revision. Listing does not restore or publish anything.
