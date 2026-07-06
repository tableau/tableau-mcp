# Visualization Templates — Reference Guide

The `inject_template_visualization` tool **no longer exists**. However, the current XML-based workflow has two template mechanisms:

1. **`tableau-inject-template`** (registered MCP tool) — injects XML templates from `data/data-visualization-templates-xml/` into a workbook cache file. Supports `{{PLACEHOLDER}}` substitution. Use `tableau-list-templates` to see available templates.
2. **JSON reference templates** in `data/data-visualization-templates/` — 32 files in the old JSON node format. They are **not loadable** via any tool; use them as structural reference only.

This module covers both, with emphasis on finding patterns in the modern XML workflow.

---

## Status of the JSON Templates

The 32 templates in `data/data-visualization-templates/` are in the **old JSON node format** (e.g. `{"type": "color", "attrs": {"column": "..."}}`) from the previous JSON-based extension approach. They are **not directly loadable** via `tableau-apply-workbook`, which requires valid `.twb`/`.twbx` XML.

They remain useful as **structural reference** — they show what a complete, minimal worksheet configuration looks like for various chart types.

---

## Preferred Approach: `tableau-search-examples`

In the new XML workflow, the primary way to find confirmed working patterns is:

```
tableau-search-examples(query="bar chart sorted by measure")
```

This searches Will's corpus of 60+ real XML examples — actual `.twb` files exported from Tableau — and returns fragments you can adapt directly. These are in native XML format, requiring no conversion.

**Use `tableau-search-examples` instead of the JSON templates for:**
- Finding field-wiring patterns for specific chart types
- Getting a working `<pane>` + `<encodings>` + `<datasource-dependencies>` block
- Discovering shelf syntax for dual-axis, Gantt, map, or table calc charts

---

## Using the JSON Templates as Structural Reference

When no search example matches, you can still consult the JSON templates as a structural guide. The key sections to look at:

| Template section | What to look for | XML equivalent |
|---|---|---|
| `worksheet.children[view].children[datasource-dependencies]` | Column + column-instance defs | `<datasource-dependencies>` children |
| `worksheet.children[pane].children[encodings]` | Encoding types used | `<encodings>` children (`<color>`, `<size>`, `<lod>`, etc.) |
| `worksheet.children[pane].children[mark]` | Mark class | `<mark class="Bar"/>` |
| `worksheet.children[rows/cols]` | Shelf content (CI strings) | `<rows>`, `<cols>` text content |

**JSON → XML conversion rules (quick reference):**

```
{"type": "color",     "attrs": {"column": "[DS].[none:Cat:nk]"}}
→ <color column="[DS].[none:Cat:nk]"/>

{"type": "encodings", "children": [...]}
→ <encodings>...</encodings>

{"type": "zone",      "attrs": {"h": "100000", "id": "1", "type-v2": "layout-basic", "w": "100000", "x": "0", "y": "0"}}
→ <zone h="100000" id="1" type-v2="layout-basic" w="100000" x="0" y="0"/>
```

General rule: `"type"` becomes the element tag name, `"attrs"` keys become XML attributes, `"children"` become child elements, `"content"` becomes element text content.

---

## Building a New Worksheet from Scratch (XML Workflow)

Instead of injecting a template, build the worksheet XML directly:

1. Call `tableau-get-workbook` to get the cached XML file path.
2. Parse it with `xml.etree.ElementTree`.
3. Deep-clone an existing `<worksheet>` element as a starting point, or construct one from scratch using patterns from `workbook-worksheets.md`.
4. Patch only what needs to change (mark type, shelf fields, encodings).
5. Append the new `<worksheet>` to `<worksheets>` and a matching `<window>` to `<windows>`.
6. Save and submit via `tableau-apply-workbook`.

This "duplicate-and-modify" approach is faster and less error-prone than building from scratch. See `workbook-worksheets.md` for the required `<window>` node and incremental add guidance.

---

## Template Files (for Reference)

Located in `data/data-visualization-templates/`. Browse these to understand chart structure:

- `bar-chart.json` — horizontal/vertical bar
- `line-chart.json` — time-series line
- `scatter-plot.json` / `connected-scatterplot.json` — scatter patterns
- `map-*.json` — filled map / symbol map shells
- `gantt.json` — Gantt bar chart
- `treemap.json`, `heatmap.json`, `highlight-table.json` — area/color fills
- `bump-chart.json` — dual-axis rank chart
- `waterfall.json` — Gantt-based waterfall

These files are **not enumerated in any MCP tool** after the v2.0.0 refactor. They are read-only reference material.

---

## When to Use

Use this module when you need to:

- **Inject a pre-built XML template** into a workbook — use `tableau-inject-template` with XML templates from `data/data-visualization-templates-xml/`
- **Find a starting structure** for a specific chart type and the old JSON templates are the only available reference
- **Understand the JSON-to-XML conversion mapping** when translating legacy template snippets into TWB XML
- **Learn the preferred modern approach** (`tableau-search-examples` + duplicate-and-modify) instead of template injection
- Quickly recall which **template files exist** in `data/data-visualization-templates/` and what chart type each covers

For building new worksheets in the current XML workflow, see `workbook-worksheets.md`.

---

## Best Practices

- **Use `tableau-search-examples` first**: Before consulting JSON templates, search the example corpus — it returns native XML fragments that can be used directly without conversion.
- **Use duplicate-and-modify instead of building from scratch**: Call `tableau-get-workbook`, deep-clone an existing `<worksheet>` element, patch only what changes (mark type, fields, encodings), and submit. This is faster and less error-prone than template injection.
- **Treat JSON templates as structural reference only**: The JSON format is the old extension-based format and is not directly loadable via `tableau-apply-workbook`. Use the JSON-to-XML conversion rules in this file to translate patterns when needed.
- **Only patch mark type, shelf fields, and encodings between chart variants**: Everything else (datasource-dependencies, column-instances, computed-sort) can often stay identical between similar charts.

---

## Common Mistakes

1. **Attempting to submit JSON templates directly**: The templates in `data/data-visualization-templates/` are in the old JSON node format and cannot be passed to `tableau-apply-workbook`, which requires valid TWB XML.
2. **Confusing the `inject_template_visualization` tool with `tableau-inject-template`**: The old `inject_template_visualization` tool no longer exists. The current `tableau-inject-template` tool loads **XML** templates from `data/data-visualization-templates-xml/`, not the JSON templates in `data/data-visualization-templates/`. JSON templates are read-only reference files.
3. **Looking for templates in MCP tool listings**: These files are not enumerated by any MCP tool after v2.0.0. Browse them directly at `data/data-visualization-templates/` if needed.
4. **Skipping `tableau-search-examples`**: The example corpus of 60+ real XML files is almost always a better source than the JSON templates. Always search the corpus first.

---

## Implementation

To build a new chart using templates as reference:

1. **Call `tableau-search-examples`** with a description of the desired chart (e.g. `"bar chart sorted by measure"`). If a matching example is returned, adapt it directly — no conversion needed.
2. **If no example matches**, browse the JSON templates in `data/data-visualization-templates/` and identify the most similar chart type.
3. **Apply the JSON-to-XML conversion rules** from this file to translate the relevant sections (encodings, mark type, shelf content, column-instances) into XML.
4. **Call `tableau-get-workbook`**, deep-clone a similar existing `<worksheet>` as a base, patch the translated elements into it, append a matching `<window>`, and submit via `tableau-apply-workbook`.
5. **Verify** with `tableau-list-worksheets` and inspect the result with `tableau-get-workbook`.
