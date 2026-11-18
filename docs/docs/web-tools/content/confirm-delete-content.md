---
sidebar_position: 2
---

# Confirm Delete Content

Executes a deletion previously previewed by [Delete Content](delete-content.md). The MCP App calls
this tool after the user confirms in the rendered interface. Cooperating clients hide it from the
model; this is an app-only tool (`ui.visibility: ["app"]`); this hint alone is not a server authorization boundary.

## Access requirements

- **User/site roles:** `SupportUser`, `SiteAdministratorExplorer`,
  `SiteAdministratorCreator`, or `ServerAdministrator`. The tool checks administrative access
  at request time, even when registration-time role enforcement is disabled.
- **Declared registration minimum:** `SupportUser`. See [role enforcement](../overview.md#role-enforcement)
  for when this filters the tool list and which roles qualify.
- **Availability:** `ADMIN_TOOLS_ENABLED=true` or the `admin-tools` feature flag.
- **MCP App:** the `mcp-apps` feature flag must also be enabled; intended for app confirmation.

## Arguments

| Argument | Required | Description |
| --- | --- | --- |
| `resourceType` | Yes | `"workbook"`, `"datasource"`, or `"extract-refresh-task"`. |
| `resourceId` | Yes | Content LUID or extract refresh task UUID. |
| `cleanupDate` | No | Workbook/data source preview's cleanup batch date, `YYYY-MM-DD` in UTC; defaults to today. |
| `minAgeDays` | No | Workbook/data source staleness threshold used by the preview, integer 1–3650; defaults to the server threshold. |

## Confirmation checks

The server requires fresh preview evidence for the same target and caller and checks administrative
access again. Workbook and data source deletions also require the matching pending-deletion batch
tag, an unexpired batch, and a successful Admin Insights staleness check. Those deletions therefore
require Tableau Cloud with accessible Admin Insights. Extract refresh task deletion uses preview
evidence without the content-tag and staleness checks. Missing or expired evidence requires a new
preview. See [Delete Content](delete-content.md) for the full workflow and recovery behavior.
