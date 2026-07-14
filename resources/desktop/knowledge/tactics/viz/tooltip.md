# Tooltip Encodings

Tooltip is the one marks-card property that does NOT join the view's level of detail. That makes it the one place where a raw dimension reference is a render hazard: in an aggregated view Tableau must convert a tooltip dimension via `ATTR()`, and a directly-authored `none:` column-instance defeats that conversion — the XML applies "successfully", then the sheet renders BLANK with `cannot be converted to a measure using ATTR()` on the pill.

Related: `tactics/viz/marks-and-encodings.md` (general encoding XML, multiple encoding instances). Preflight backstop: validation rule `tooltip-dimension-requires-attr` blocks the broken shape at apply time.

## When to Use

- Adding a dimension to Tooltip as hover context on an aggregated view (bar/line/map at a coarser grain than the dimension) — use `attr:` derivation, this file's core rule.
- Any tooltip authoring where the view has aggregate refs (`sum:`, `avg:`, `cnt:`, …) on shelves or encodings.
- NOT needed for measures on tooltip (they aggregate normally) or for fully disaggregated views (`<aggregation value="false"/>`), where `none:` tooltip dimensions are legal.

## Best Practices

- **Dimension on Tooltip in an aggregated view → `derivation="Attribute"`, prefix `attr:`.** Declare the Attribute column-instance and reference it from `<tooltip>`:

```xml
<column-instance column="[Segment]" derivation="Attribute" name="[attr:Segment:nk]" pivot="key" type="nominal"/>

<encodings>
  <tooltip column="[DS].[attr:Segment:nk]"/>
  <tooltip column="[DS].[sum:Sales:qk]"/>
</encodings>
```

- Keep the suffix aligned to the instance type: string/nominal `:nk`, ordinal `:ok`, quantitative ATTR `:qk` (confirmed shape: `[attr:...:nk]` tooltip fields in aggregated worksheets, e.g. Tableau Public "Trellis Chart" example).
- The canonical derivation string is `Attribute` — `Attr` is invalid and gets silently rewritten by Tableau (see the `invalid-derivation-string` rule).
- If the tooltip value must be computed at the aggregate level, a `usr:` (derivation="User") aggregated calc is the alternative to `attr:`.

## Common Mistakes

- **`none:` dimension on `<tooltip>` in an aggregated view — blanks the sheet (confirmed P0, GUS W-23447711).** This FAILS at render after applying cleanly:

```xml
<view>
  <datasource-dependencies datasource="DS">
    <column datatype="string" name="[Segment]" role="dimension" type="nominal"/>
    <column datatype="real" name="[Sales]" role="measure" type="quantitative"/>
    <column-instance column="[Segment]" derivation="None" name="[none:Segment:nk]" pivot="key" type="nominal"/>
    <column-instance column="[Sales]" derivation="Sum" name="[sum:Sales:qk]" pivot="key" type="quantitative"/>
  </datasource-dependencies>
  <aggregation value="true"/>
</view>
<panes><pane><encodings>
  <tooltip column="[DS].[none:Segment:nk]"/>
  <tooltip column="[DS].[sum:Sales:qk]"/>
</encodings></pane></panes>
```

- Retrying the same XML because `tableau-apply-workbook` reported success — apply success does NOT mean the sheet rendered; this shape is the canonical false-PASS.
- Confusing tooltip with text/label: dimensions on Text/Label JOIN the view grain (like Detail), so `none:` is legitimate there. Do not "fix" text encodings to `attr:` by analogy.
- Using `derivation="Attr"` instead of `Attribute`.

## Implementation

1. Author the Attribute column-instance for the dimension alongside the existing declarations in `<datasource-dependencies>`.
2. Point the `<tooltip>` encoding at the `attr:` instance name (never the `none:` instance) whenever the view is aggregated.
3. Disaggregated exception: with `<aggregation value="false"/>` (one mark per row), `none:` tooltip dimensions are valid — Tableau is not ATTR-converting at an aggregated mark grain.
4. Preflight: the `tooltip-dimension-requires-attr` validation rule errors on the broken shape with a FIX line; do not acknowledge past it — change the derivation.
