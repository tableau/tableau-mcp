---
sidebar_position: 4
---

# Move Workbook

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Moves a workbook into a different project. Use list-projects to discover available project IDs.nPass personalSpace: true instead of projectId to move it into your Personal Space (passing both is an error).

## APIs called

Talks to Tableau Cloud or Tableau Server.

- Moves a workbook into a different project.

## Required arguments

### `workbookId`

The LUID of the workbook to move.

## Optional arguments

### `projectId`

The LUID of the destination project. Use list-projects to discover available project IDs. Do not pass a Personal Space LUID; use personalSpace instead.

### `personalSpace`

Set true to move the workbook into your Personal Space instead of a project.

:::note
Pass exactly one destination.

- Omitting both is refused with `move-workbook requires one of projectId or personalSpace: true.`
- Passing both is refused with `move-workbook accepts only one of projectId or personalSpace: true, not both.`
- A read-only Personal Space cannot be the move target. The tool refuses with `Your Personal Space is read-only and cannot be used as a move target; pass projectId (use list-projects) to move to a project instead.` Discover project LUIDs with [`list-projects`](../projects/list-projects.md).
:::
