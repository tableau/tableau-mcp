---
sidebar_position: 6
---

# Move Workbook

Moves a workbook from its current Tableau project to a different project.

:::warning[Disabled by Default]
This tool is gated behind the `data-apps` feature flag, which defaults to `false` in
`features.json`. It is unavailable unless an administrator enables `data-apps`. See
[Feature Flags](../../developers/feature-flags.md).
:::

Related tools: [List Projects](../projects/list-projects.md), [List Workbooks](list-workbooks.md)

## Required permissions

- **Site Role**: Requires Explorer (Can Publish) role or higher

## Required arguments

### `workbookId`

The ID of the workbook to move, potentially retrieved by the
[List Workbooks](list-workbooks.md) tool.

Example: `222ea993-9391-4910-a167-56b3d19b4e3b`

### `projectId`

The Tableau project LUID of the destination project to move the workbook into. Use
[List Projects](../projects/list-projects.md) to discover available project IDs.

Example: `cbec32db-a4a2-4308-b5f0-4fc67322f359`

If this MCP server is configured with a bounded project context, moving a workbook into (or out
of) a project outside that context returns an error instead of moving it.
