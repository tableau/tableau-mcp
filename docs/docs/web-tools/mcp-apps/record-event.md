---
sidebar_position: 3
---

# Record Event

Records a product telemetry event from an MCP App. It forwards the event with the current site's,
user's, and authentication context and returns `{ recorded: true }`.

## Access requirements

- **User/site role:** `Viewer` or higher in the MCP role hierarchy; Tableau content
  permissions and site capabilities also apply.
- **Declared registration minimum:** `Viewer`. See [role enforcement](../overview.md#role-enforcement)
  for when this filters the tool list and which roles qualify.
- **Availability:** the `mcp-apps` feature flag must be enabled.

## Arguments

| Argument | Required | Description |
| --- | --- | --- |
| `event_type` | Yes | At most 64 characters, matching `^[A-Z][A-Z0-9_]*$`, such as `TOOL_ERROR` or `OPEN_IN_TABLEAU_CLICKED`. |
| `message` | No | Event detail; truncated to 1,024 characters. |

## Visibility

This is an app-only helper (`ui.visibility: ["app"]`). Cooperating clients hide it from the model;
the visibility hint alone is not a server authorization boundary. It does not query Tableau content.
