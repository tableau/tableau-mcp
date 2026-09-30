# Listing workbooks

Supporting reference for step 2 of `test-skill`.

## Tool

Use the `list-workbooks` tool. It returns the workbooks the authenticated user can
access on the current Tableau site. No parameters are required to list everything.

## Presenting results

- List every workbook returned.
- Prefer a Markdown table with the workbook name and its project when a chat or Slack
  surface is being used.
- If no workbooks are returned, say so explicitly rather than printing an empty table.
