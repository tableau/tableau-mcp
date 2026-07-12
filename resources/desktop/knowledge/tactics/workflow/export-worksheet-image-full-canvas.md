# Exporting a Full-Canvas Worksheet Image from the Tableau Agent API

## Scope Check

- Primary audience: Tableau User
- Authoring outcome improved: Agent can capture a full-canvas screenshot of a worksheet (including axes, labels, title, and caption) to visually verify the viz it just built — and to check whether the viz surfaces a valuable insight from the underlying data.
- In-scope reason: Covers a Tableau Agent API command pattern used during workbook authoring to validate viz output.
- Out-of-scope risk: Not a general screenshotting tool. The screenshot contains actual rendered data values, not just workbook metadata — see When to Say No.
- Tags: screenshot, export, image, worksheet, agent-api, tabdoc, verify, visual-verification
- Relevant user prompts/search terms: "how do I export a worksheet as an image", "take a screenshot of a viz", "prefetch layout options before export", "worksheet image includes axes and labels", "confirm viz looks right after apply", "visual verification of rendered output", "export includes actual data values", "get-export-image-layout-options required first"

## When to Use

Use this after applying a worksheet change via the agent — for example after adding fields to rows/columns — when you want to confirm the viz looks right or check whether it reveals a meaningful insight in the data.

This applies to:

- Any Tableau user working with the Tableau Desktop Agent API
- Worksheet-level views (for dashboards, use the dashboard export pattern instead — see Related Knowledge)
- macOS and Windows (file output path varies by OS — see Implementation)

## Best Practices

- Always prefetch the layout options object before calling the export command — it is a required parameter and cannot be constructed by hand.
- Use this to do a quick sanity check on the rendered output after each `tableau-apply-worksheet` call, especially when building a new viz from scratch.
- Tell the user what you are doing before taking the screenshot — the file is written to a temp location on disk and contains actual rendered data values, not just workbook structure.
- Delete or disregard the temp file once the verification is done; it is not part of the workbook and is not cleaned up automatically.

### When to Say No

Unlike reading workbook XML (which only exposes metadata and field names), a full-canvas screenshot captures the actual data values rendered in the viz and writes them to a file on the local disk outside the workbook itself. This is a meaningful step up in data exposure.

For most scenarios the user has already consented to this by connecting to the data in the first place. However, proceed with transparency:

> "I'm going to take a screenshot of this worksheet to check whether it looks right. The image will include the actual data values from your connected source and will be saved temporarily to your local disk. Let me know if you'd prefer I skip this step."

Do not use this command if the user has indicated the underlying data is sensitive and should not be written to disk outside the workbook.

## Common Mistakes

- **Omitting the prefetch step.** `export-image-layout-options` is required and must be fetched first — always run Step 1 before Step 2.
- **Assuming the file path is fixed.** Always use an explicit `file-name` argument with an absolute path you control. On macOS, `/private/tmp` is confirmed; other OS paths have not been verified.

## Implementation

Two-step process — the second call depends on the first:

**Step 1 — Fetch the layout options:**

```
tabdoc:get-export-image-layout-options
  worksheet: "Sheet 1"   ← name of the worksheet to export
```

This returns an `exportImageLayoutOptions` object. Copy it exactly as returned.

**Step 2 — Export the image:**

```
tabdoc:export-worksheet-image
  file-name: "/private/tmp/my-chart.png"   ← absolute path; adjust for OS
  mime-type: "image/png"
  export-image-layout-options: <object from Step 1>
  worksheet: "Sheet 1"
```

A successful call returns an empty `{}` result. The file is then readable from the path you specified.

**What the output includes:** title, row/column headers (dimension labels), axes with tick marks, marks (bars, lines, etc.), and the automatic caption ("Sum of Sales for each Category" style). Legends are included if present.

**OS note:** On macOS, `/private/tmp` is the confirmed working location. Windows and Linux paths have not been verified — use a known writable absolute path.

## Related Knowledge

- Companion to [Exporting a Full-Canvas Dashboard Image from the Tableau Agent API](data/knowledge/tactics/workflow/export-dashboard-image.md): covers the equivalent single-step pattern for full dashboard views.

## Source and Confidence

- Source/evidence type: Live session — confirmed working in Tableau Desktop with Superstore data, bar chart (Category × SUM(Sales))
- Source: Ben Hart, SE, 2026-06-08
- Customer-identifying details removed: n/a
- Confidence: field-tested
- Last reviewed: 2026-06-08
