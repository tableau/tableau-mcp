# TWB XML Grammar: Element Child-Order & Required Attributes

The content-model dictionary for hand-authoring workbook XML: the exact child-order sequence and required attributes of each load-bearing element, distilled from the Tableau product XSD set.

The difference between "well-formed XML" and "XML Tableau will actually load."

## Scope Check

- Primary audience: Tableau user
- Authoring outcome improved: create, validate, troubleshoot
- In-scope reason: Getting element child-order, required attributes, and the formatter-vs-fixture form exactly right is what separates a `.twb` that loads from one Tableau rejects or silently strips — the lookup layer beneath the authoring playbook.
- Out-of-scope risk: none
- Tags: twb, xml, grammar, child-order, schema, xsd, column-instance, encodings, mark-class, zones, datasource-dependencies
- Relevant user prompts/search terms: "what order do the elements go in", "child order of pane / table / zone", "required attributes for column-instance", "this element is not expected error", "mark class vs type", "encoding column vs attr field", "rows cols after panes", "zone child order", "reference line required attributes"

## When to Use

Use this as the structural reference when hand-authoring or repairing workbook XML and you hit an ordering/attribute error ("element X is not expected; expected is Y", "missing required attribute", silent field/mark drop). It answers "what's the exact shape, order, and required attrs of this element." For the *version/manifest* choice and the error-code→fix table see [TWB Authoring Form](data/knowledge/tactics/tree/twb-authoring-form.md); for the enum value lists (mark classes, derivation tokens, filter classes, zone types) see `expertise://tableau/tactics/tree/enums`; for the on-disk tree overview see `expertise://tableau/tactics/tree/workbook-structure`.

## Best Practices

### Two epistemic traps to resolve first

1. **Test fixtures are NOT Desktop output.** The product's `v26_1/*.twb` test files feed a *lenient* search-indexer and use shapes a strict load rejects — notably `<encoding attr='color' field='…'/>` *inside* `<pane>`, and `default-aggregation='sum'` on `<column>` (not in the grammar at all). Trust fixtures for **datasource** structure (columns, parameters, groups); author the **formatter form** below for **worksheet** panes/marks.
2. **Many "required" errors are feature-flag/branch artifacts.** The shipped product compiles one branch of each `<!--?IF Flag-->/<!--?ELSE-->`. Never hand-author `<mark type=>` (shipped branch is `class`), `<worksheet number=>`/`<worksheet-number>` (test-only `SheetNumTstAddOnly`), or `default-aggregation` on a column.

### Child-order sequences (strictly enforced)

Order is a `<xs:sequence>` — out-of-order children fail with "element X is not expected."

- **`<workbook>`:** `document-format-change-manifest? → repository-location? → preferences? → style? → actions? → datasources → worksheets? → dashboards? → windows? → thumbnails?` Required attr: `version`. `<worksheets>`/`<dashboards>` enforce unique `name`.
- **`<table>` (in a worksheet):** `view → style? → panes → mark-layout? → rows → cols → pages? → subtotals? → table-calculations? → show-full-range? → percentages? → mark-labels? → forecast?` — **rows/cols come AFTER `<panes>`; `<pages>` after `<cols>`.**
- **table-level `<view>`:** `datasources → mapsources? → datasource-dependencies → filters (each `<filter>` or `<hide-filter>`, optionally followed by its `<sort>`) → shelf-sorts? → slices? → aggregation`. `<aggregation value='true'/>` is effectively required.
- **`<pane>`:** the XSD master declares `view(<breakdown value=…/>) → mark → mark-sizing? → encodings? → label-data* → dropline? → trendline? → reference-line* → customized-tooltip? → customized-label? → style?`. **But pane children are NOT as strictly enforced at load as the rest** — a real `get-workbook-xml` dump in `expertise://tableau/tactics/tree/workbook-structure` shows `<encodings>` *before* `<mark>`, the reverse of the XSD sequence, and it loads. Safe rule: keep `<style>` **last** and `<reference-line>` after `<encodings>`; treat the mark↔encodings order as flexible (match a real same-version file if unsure). *Verify by opening which order your target Desktop build writes.*
- **`<column>` (datasource):** `localized-server-captions? → calculation? → aliases? → semantic-role? → user-description? → (members | range)?`.
- **`<column-instance>`:** `table-calc* → utility-members? → aliases?`.
- **`<dashboard>`:** `(repository-location | vizlayoutoptions){0,2} → style? → size? → datasources&deps → zones → devicelayouts? → simple-id`.
- **`<zone>`:** `formatted-text? → layout-cache? → (nested zone)* → flipboard? → (button|add-in|layout)? → zone-style?` — `<layout-cache>` is **first**, `<zone-style>` comes **after** nested child zones.
- **worksheet `<window>`:** `<cards> → simple-id?`. **dashboard `<window>`:** `<viewpoints> → <active id=…/> → device-preview? → simple-id?`. (The XSD *group* names these `visual-doc`/`visual-docs`, but the element Tableau actually writes — and that error messages reference — is `<cards>` / `<viewpoints>`; author the latter, matching [TWB Authoring Form](data/knowledge/tactics/tree/twb-authoring-form.md) and the real-file dump. An empty `<viewpoints/>` is the fatal line-less `2805CF18`.)

### Required attributes per element

- **`<column>`:** `name` (`[Bracketed]`), `role` (`dimension|measure|unknown`), `type` (`nominal|ordinal|quantitative|unknown`), `datatype` (`string|integer|real|boolean|date|datetime|spatial|table`). Explicit aggregation is the **capitalized** `aggregation='Sum'` — never `default-aggregation`.
- **`<column-instance>`:** all five of `name`, `column`, `type`, `pivot` (`key|alias`), and `derivation` (the aggregation, capitalized — `None`/`Sum`/`Avg`/`CountD`/`Year`…). The `name` token is **lowercase** (`[sum:Sales:qk]`) while the `derivation` attribute is **capitalized** (`derivation='Sum'`) — both required, keep consistent. (Full token/casing list: `expertise://tableau/tactics/tree/enums`.)
- **`<mark>`:** `class` (required — NOT `type`). Enum in the tactics `enums` reference; `Sankey`/`Sunburst`/`Heatmap`/`VizExtension` are feature-flag-gated.
- **`<reference-line>`:** `id`, `axis-column`, `value-column`, `scope` (`per-cell|per-pane|per-table`), `label-type`, `z-order`, `formula` (`constant|total|sum|min|max|average|median|quantiles|percentile|stdev|confidence`), `enable-instant-analytics`.
- **`<filter>`:** `column` (the **column-instance** pill, not the base column — the #1 filter trap), `class` (`categorical|quantitative|relative-date`). `filter-group` is optional (omit = independent AND filters).
- **`<zone>`:** `x`, `y`, `w`, `h` (int, 0–100000 space), `id` (unique within `<zones>`). Container type is `type-v2` (`layout-basic` outermost; `layout-flow` + `param='horz'|'vert'` for rows/cols); leaf zones carry `name=` only.
- **`<layout-cache>`:** `type-w` and `type-h` (`fixed|cell|scalable`), + optional min/max/fixed sizes.

### The encodings form (the #1 worksheet trap)

Inside `<pane><encodings>`, the Desktop **formatter** emits **element-named children with `column=`**:
```xml
<encodings>
  <color column='[ds].[none:Region:nk]'/>
  <wedge-size column='[ds].[sum:Sales:qk]'/>
</encodings>
```
Children: `color, size, text, shape, wedge-size, lod, geometry, image, tooltip, path, level, edge, custom` (any count/order). The `<encoding attr='color' field='…' type='palette'>` form is a **different element** used only inside a `<style-rule>` for palette/axis/legend formatting — never inside `<pane><encodings>`. Discrete-color-to-hex maps live in that style-rule form (and the mapped column-instance must also be declared at datasource scope — see the authoring-form entry).

### Feature-flagged elements need their flag in the manifest

Any `<!--?IF Flag-->` element only loads if its flag is in the document's `<document-format-change-manifest>` (or the build's capabilities). Confirmed by open: `<computed-sort>` without `<SortTagCleanup/>` fails with "no declaration found for element 'computed-sort'." Either include the flag, use `<ManifestByVersion/>`, or emit the non-flagged legacy form.

### `<rows>`/`<cols>` are simple string content

The pill algebra is a string: `[ds].[sum:Sales:qk]`. Field separators (`/`, `*`, `+`, `,`) are interchangeable to the parser — use `/`. `<pages>` by contrast is *element* content (`<column>QN</column>`+). Join multiple measures on one shelf with `+` in parens; space-separated causes "Malformed expression."

## Common Mistakes

- Emitting children out of the strict sequence (rows/cols before panes; pane `<style>` not last; `<zone-style>` before nested zones; `<layout-cache>` not first) → "element X is not expected."
- Copying the fixture `<encoding attr= field=>` form into a real `<pane>` instead of `<color column=>` → marks don't encode.
- Using the base column (`[Status]`) instead of the column-instance pill (`[none:Status:nk]`) in a filter/encoding/shelf `column=`.
- Mixing the derivation casing — lowercase name token vs capitalized `derivation=` attribute must both be present and agree.
- Authoring `<mark type=>`, `<worksheet number=>`, or `default-aggregation` (all wrong/test-only branches).
- Emitting a feature-flagged element without its flag in the manifest.

## Implementation

When a `apply-workbook` fails on structure ("element not expected", "missing required attribute", silent drop), look up the offending element here for its exact child-order position and required attrs, then fix the sequence/attributes. Note the MCP `validate-workbook-xml` and `validate-worksheet-xml` tools check **well-formedness only** (parseable XML) — they do NOT catch the child-order/required-attr/enum mistakes this entry is about; that's what **diffing against a known-good same-version real `.twb`** surfaces, and opening in Tableau is the final proof. For value enums, defer to the tactics `enums` reference rather than restating them here.

## Related Knowledge

- Pairs with [TWB Authoring Form](data/knowledge/tactics/tree/twb-authoring-form.md): that is the *playbook* (version/manifest choice, the build workflow, the error-code→fix table); this is the *grammar dictionary* (per-element child order + required attrs). They reference each other, not duplicate.
- Defers value enums to `expertise://tableau/tactics/tree/enums` (mark classes, derivation tokens, filter classes, zone types) and the tree overview / real-file dump to `expertise://tableau/tactics/tree/workbook-structure` (the canonical core entry this is flagged to promote into).
- The encodings/color-map and filter-pill rules connect to [Field & Mark Type Reference](data/knowledge/strategy/analytics/field-types-reference.md).

## Source and Confidence

- Source/evidence type: external reference (adapted with permission)
- Source: adapted from `plugin-tableau-master` (`references/twb-xml-grammar.md`) by Jon Plax, used with the author's permission. Underlying grammar traces to the Tableau product XSD set (`sf-analyticscloud/monolith` `modules/XSD/`) and real-corpus dissection. The structural-diff capability the plugin's `twb-diff.py` provides is a tooling gap here (our MCP `validate-workbook-xml` / `validate-worksheet-xml` tools do well-formedness only — see `docs/tooling-gaps.md`); until it exists, diff manually against a real `.twb` dump from `get-workbook-xml`. Rows marked confirmed-by-open in the source were verified against Tableau Desktop 2026.2; treat unverified grammar specifics as strong leads until opened.
- Customer-identifying details removed: n/a
- Confidence: draft
- Last reviewed: 2026-06-19

## Runtime Classification

- Knowledge type: authoring-expertise
- Runtime visibility: server-side-only
- Version binding: Desktop/Studio version (26.1 / 26.2 format era)
- Customer customization allowed: no
- Tool/API dependency: `validate-workbook-xml`, `validate-worksheet-xml`, `apply-workbook`
- Eval candidate: yes
- Eval coverage: none
- Promotion target: system-instructions
