---
sidebar_position: 2
---

# Get Embed Token

Supplies the MCP App with a Tableau-signed JWT for embedding a view. It takes no arguments and
returns `{ token }`. A current Tableau Bearer JWT is passed through; otherwise the server signs an
embed token using direct-trust or UAT signing material. If no suitable material is available, the
tool reports that an embed token is unavailable.

## Access requirements

- **User/site role:** `Viewer` or higher in the MCP role hierarchy; Tableau content
  permissions and site capabilities also apply.
- **Declared registration minimum:** `Viewer`. See [role enforcement](../overview.md#role-enforcement)
  for when this filters the tool list and which roles qualify.
- **Availability:** both `mcp-apps` and `interactive-viz` feature flags must be enabled.

## Visibility

This is an app-only helper (`ui.visibility: ["app"]`). Cooperating clients hide it from the model;
the visibility hint alone is not a server authorization boundary. The token is intended for the app
and should not be included in assistant text. See [Render Interactive Viz](../views/render-interactive-viz.md).
