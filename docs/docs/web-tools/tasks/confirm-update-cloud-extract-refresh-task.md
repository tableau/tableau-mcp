---
sidebar_position: 3
---

# Confirm Update Cloud Extract Refresh Task

Applies a Tableau Cloud extract refresh schedule change previously previewed by
[Update Cloud Extract Refresh Task](update-cloud-extract-refresh-task.md). The MCP App invokes it
when the user approves the change in the rendered interface. It replaces the existing schedule
wholesale; restoring the old schedule requires another update with the previous values.

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
| `taskId` | Yes | Extract refresh task UUID from the preview. |
| `schedule` | Yes | The complete replacement schedule, exactly as previewed. See the [schedule fields](update-cloud-extract-refresh-task.md#arguments). |

## Confirmation checks

The server checks administrative access and requires fresh, single-use preview evidence bound to
both `taskId` and `schedule`. A different schedule, missing preview, or expired evidence is rejected.
This tool is marked app-only (`ui.visibility: ["app"]`); cooperating clients hide it from the model.
The visibility hint alone is not a server authorization boundary. It is a Tableau Cloud tool and
does not update Tableau Server schedules.
