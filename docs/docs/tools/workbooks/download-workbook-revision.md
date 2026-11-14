---
sidebar_position: 20
---

# Download Workbook Revision

Downloads an explicit past workbook revision as TWB or TWBX. This does not restore the revision or change the current workbook.

## Required permissions

ExplorerCanPublish or higher, site revision history enabled, and the workbook/project permissions required by Tableau for revision downloads.

## APIs called

- [Download Workbook Revision](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#download_workbook_revision)
- Query Workbook when tool scoping requires an eligibility check.

## Required Tableau API scopes

`tableau:workbooks:download`, `tableau:content:read` and `tableau:mcp_site_settings:read`.

## Arguments

| Argument | Required | Description |
| --- | --- | --- |
| `workbookId` | Yes | Workbook LUID. |
| `revisionNumber` | Yes | Positive integer from List Workbook Revisions. |
| `includeExtract` | No | Whether to include extracts. |

## Response behavior

Uses the same local temporary-file or presigned resource-link contract as [Download Workbook](download-workbook.md). The original file bytes are preserved. Tableau rejects unavailable/deleted revisions and disabled history. The current revision must be downloaded with Download Workbook; the tool never silently substitutes the current revision.
