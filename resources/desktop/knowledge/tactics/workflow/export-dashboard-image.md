# Exporting a Full-Canvas Dashboard Image from the Tableau Agent API

## Scope Check

- Primary audience: Tableau User
- Authoring outcome improved: Agent can capture a full-canvas screenshot of a composed dashboard (all zones, layout, text objects, and embedded sheets) to visually verify what it built and check whether the dashboard surfaces a valuable insight from the underlying data.
- In-scope reason: Covers the confirmed Tableau Agent API command for headless dashboard image export during workbook authoring.
- Out-of-scope risk: The screenshot contains actual rendered data values, not just workbook metadata — tell the user when a screenshot is being taken and where the file will be saved.
- Tags: screenshot, export, image, dashboard, agent-api, tabdoc, verify, visual-verification
- Relevant user prompts/search terms: "how do I export a dashboard as an image", "take a screenshot of a full dashboard", "confirm dashboard layout looks right", "dashboard image includes actual data values", "navigate to dashboard before exporting", "export-dashboard-image returns blank canvas", "tell user before taking screenshot", "visual verification of composed dashboard"

## When to Use

Use this after applying a dashboard — for example after `build-and-apply-dashboard` — when you want to confirm the composed layout looks right or check whether the dashboard reveals a meaningful insight in the data.

This applies to:

- Any Tableau user working with the Tableau Desktop Agent API
- Dashboard-level views (for individual worksheets, use the worksheet export pattern instead — see Related Knowledge)
- macOS (confirmed); Windows path behavior not verified

## Best Practices

- Use this command to verify the full composed dashboard after applying it — not just individual sheets.
- Tell the user what you are doing before taking the screenshot. The file is written to disk and contains actual rendered data values from the connected source.
- Use an absolute file path you control. On macOS, `/private/tmp/` is a confirmed working location.
- Delete or disregard the temp file once verification is done — it is not part of the workbook and is not cleaned up automatically.

### When to Say No

Do not use this for worksheet-level views — use the worksheet export pattern instead. Do not export a dashboard image if the user has indicated the underlying data is sensitive and should not be written to disk outside the workbook.

Before exporting, say something like:

> "I'm going to take a screenshot of this dashboard to check whether it looks right. The image will include the actual data values from your connected source and will be saved temporarily to your local disk. Let me know if you'd prefer I skip this step."

## Common Mistakes

- **Using this command for worksheets.** Use `tabdoc:export-worksheet-image` (with `get-export-image-layout-options` prefetch) for individual worksheet views.
- **Assuming the file path is fixed.** Always pass an explicit absolute path as `file-name`. On macOS, `/private/tmp/` is confirmed. Other OS paths have not been verified.
- **Exporting without navigating first.** If Tableau Desktop is not currently showing the dashboard, `tabdoc:export-dashboard-image` returns an empty `{}` but the output file is blank (white canvas). Always call `tabdoc:goto-sheet` to navigate to the dashboard before exporting.

## Implementation

Two-step — navigate first, then export:

**Step 1: Navigate to the dashboard**
```
tabdoc:goto-sheet
  sheet: "Dashboard 1"   ← plain dashboard name string
```

**Step 2: Export the image**
```
tabdoc:export-dashboard-image
  file-name: "/private/tmp/my-dashboard.png"   ← absolute path; adjust for OS
  mime-type: "image/png"
  dashboard: "Dashboard 1"                      ← plain dashboard name string
```

A successful call returns an empty `{}` result. The file is then readable from the path you specified.

**What the output includes:** the full composed dashboard canvas — all zones, layout, text objects, sheet titles, embedded worksheet views, and any dashboard title.

**OS note:** On macOS, `/private/tmp/` is the confirmed working location. Windows and Linux have not been verified — use a known writable absolute path.

## Related Knowledge

- Companion to [Exporting a Full-Canvas Worksheet Image from the Tableau Agent API](data/knowledge/tactics/workflow/export-worksheet-image-full-canvas.md): covers the equivalent pattern for individual worksheet views, which requires a two-step prefetch.

## Source and Confidence

- Source/evidence type: Live session — confirmed working in Tableau Desktop with a dashboard containing a bar chart and a text object
- Source: Ben Hart, SE, 2026-06-08
- Customer-identifying details removed: n/a
- Confidence: field-tested
- Last reviewed: 2026-06-08
