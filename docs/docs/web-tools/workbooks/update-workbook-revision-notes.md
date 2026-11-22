---
sidebar_position: 5
---

# Update Workbook Revision Notes

Replaces the full notes text on one existing workbook revision. It does not
publish, move, delete, or rewrite the workbook. Confirm the workbook, revision
number, and replacement text with the user before calling. Use
[list-workbook-revisions](./list-workbook-revisions.md) to identify the revision.

| Parameter | Description |
| --- | --- |
| `workbookId` | Required Tableau workbook LUID. |
| `revisionNumber` | Required positive integer. Use an existing revision number. |
| `notes` | Required string, sent as the full replacement, not an append. |

On success the tool reports the workbook ID, revision number and `updated: true`.
Tableau returns HTTP 204 without revision data; the tool does not return or
read back the notes.

This tool follows the `data-apps` workbook-write feature gate and bounded-context
restrictions. It requires Tableau REST API **3.30 or later** (Tableau Cloud
October 2026 / Tableau Server 2026.3), and on Tableau Server the site must have
revision history enabled. Tableau enforces the permissions described in
[Update Workbook Revision Notes](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_revisions.htm#update_workbook_revision_notes).
For non-admin users this requires the Explorer (Can Publish) role or higher
and the required workbook/project capabilities. The REST write scope is
`tableau:workbooks:update`; bounded-context checks can use
`tableau:content:read` and `tableau:mcp_site_settings:read`. The MCP scope is `tableau:mcp:workbook:write`.
