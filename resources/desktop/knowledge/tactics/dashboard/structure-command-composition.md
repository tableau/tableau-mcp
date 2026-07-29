# Compose a Dashboard with Structure Commands

Use Tableau structure commands to create and rename a dashboard and place already-built worksheets without hand-authoring dashboard XML.

## Scope Check

- Primary audience: Tableau agent
- Authoring outcome improved: create, compose, validate
- In-scope reason: Provides a proven fallback for assembling verified worksheets when the higher-level dashboard tools are not suitable.
- Out-of-scope risk: Structure commands do not build worksheet marks, shelves, calculations, or encodings.
- Tags: composition, worksheets, structure-commands, rename-sheet, add-sheet, tiled-layout
- Relevant user prompts/search terms: "add-sheet-to-dashboard", "dashboard shell", "place existing sheets", "rename-sheet", "tiled-layout"

## When to Use

For a straightforward dashboard request, first use `dashboard-auto-apply`; use `plan-dashboard-creation` followed by `build-and-apply-dashboard` when a planned layout is needed. Use this lower-level recipe when the worksheets already exist or must be built and verified independently, and the task only needs a dashboard shell plus tiled worksheet zones.

The proven structure sequence is:

- `tabdoc:new-worksheet` creates a worksheet named `Sheet N`.
- `tabdoc:rename-sheet` renames a worksheet or dashboard.
- `tabdoc:new-dashboard` creates a dashboard named `Dashboard N`.
- `tabdoc:add-sheet-to-dashboard` with `AddAsFloating:false` places an existing worksheet and returns a zone ID.

Build worksheet content through `bind-template`, `author-calc`, `build-and-apply-worksheet`, or the worksheet XML lane. The structure commands only compose those results.

## Best Practices

- Build and verify every source worksheet before assembling the dashboard.
- Use `bind-template` first for a named chart shape. If it returns a proposal, resubmit the same ask with that proposal and, when correcting an existing sheet, `target_worksheet`.
- Author reusable calculations before binding them by caption.
- Verify values on each source worksheet with `get-summary-data`; dashboard presence alone is not evidence that the source vizzes rendered.
- Pass `AddAsFloating:false` explicitly when adding each sheet. That exact argument shape is observed working.
- Use one targeted `search-commands` call if a command is unknown; do not guess command names.

## Common Mistakes

1. Treating `tabdoc:add-sheet-to-dashboard` as a worksheet builder. It only places an existing worksheet.
2. Looking for a standalone command that places fields on Rows, Columns, Text, or Color. No such command is confirmed; use the worksheet authoring tools.
3. Omitting `AddAsFloating`. The form without that argument is unconfirmed.
4. Declaring success after dashboard assembly without checking the source worksheets.
5. Omitting the needed date derivation in a trend proposal. An observed proposal collapsed a datetime trend to one row; adding `"derivation":"tdy"` restored the intended day-grain series.
6. Creating a duplicate worksheet instead of correcting the existing one with `target_worksheet`.

## Implementation

After building and verifying the worksheets, compose them:

```json
[
  {
    "tool": "execute-tableau-command",
    "input": {
      "session": "<session>",
      "command": "tabdoc:new-dashboard",
      "args": {}
    }
  },
  {
    "tool": "execute-tableau-command",
    "input": {
      "session": "<session>",
      "command": "tabdoc:rename-sheet",
      "args": {
        "Sheet": "Dashboard 1",
        "NewSheet": "Performance Dashboard"
      }
    }
  },
  {
    "tool": "execute-tableau-command",
    "input": {
      "session": "<session>",
      "command": "tabdoc:add-sheet-to-dashboard",
      "args": {
        "Dashboard": "Performance Dashboard",
        "Worksheet": "Win Rate by Team",
        "AddAsFloating": false
      }
    }
  },
  {
    "tool": "activate-sheet",
    "input": {
      "session": "<session>",
      "sheetName": "Performance Dashboard"
    }
  }
]
```

Repeat the add-sheet call for each verified worksheet.

### What is confirmed working

- Bare `tabdoc:new-worksheet` and `tabdoc:new-dashboard` calls create default-named objects.
- `tabdoc:rename-sheet` renames worksheets and dashboards.
- `tabdoc:add-sheet-to-dashboard` with `Dashboard`, `Worksheet`, and `AddAsFloating:false` places a worksheet and returns a zone ID.
- The dashboard can combine worksheets built through different supported authoring lanes.

### What does not work or remains unconfirmed

- No standalone field-placement command is confirmed.
- Adding a sheet without `AddAsFloating` is unconfirmed.
- Dashboard assembly does not prove worksheet marks rendered; verify the source worksheets separately.

## Source and Confidence

- Source/evidence type: live Desktop proof, sanitized for product use
- Customer-identifying and run-specific details removed: yes
- Confidence: field-tested
