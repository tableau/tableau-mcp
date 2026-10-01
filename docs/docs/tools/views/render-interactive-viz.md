---
sidebar_position: 4
---

# Render Interactive Viz

Displays a Tableau workbook or view as a live interactive embed. The user can filter, drill down,
hover, and change selections in place. Use [Get View Image](get-view-image.md) instead when a static
snapshot is required.

## Availability

This tool is registered only when all of the following are true:

- The `mcp-apps` feature flag is enabled.
- The connected client is not a known incompatible MCP Apps client. The tool is hidden rather than
  exposed as a plain-text fallback in that case.
- Authentication is not PAT authentication or OAuth using Tableau MCP's embedded authorization
  server.

The client must support MCP Apps to render the returned interface.

## Required arguments

### `luid`

The LUID of the workbook or view to render.

### `objectType`

Whether `luid` identifies a `workbook` or a `view`.

## Result

Returns the selected object's `luid`, `objectType`, and `name`, together with the URL used by the
MCP App to render the interactive visualization.
