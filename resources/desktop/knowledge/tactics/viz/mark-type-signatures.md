# Tableau Mark Type Signatures

Lookup table: XML shelf configuration → chart type (and reverse). Use this when reading a workbook to identify the chart type, or when writing a workbook to produce a given chart type. All patterns confirmed via XML injection + screenshot (2026-06-25).

---

## Scope Check


- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: create, validate, troubleshoot
- In-scope reason: Empirically confirmed Tableau XML patterns that directly govern how agents correctly author worksheet XML.
- Out-of-scope risk: none
- Tags: mark-type, chart-type, automatic, bar, line, circle, pie, treemap, breakdown, scatter, text-table, rows, cols, encodings
- Relevant user prompts/search terms: "how do I identify a chart type from XML", "what XML creates a treemap", "treemap requires breakdown on", "Automatic vs Bar interchangeable", "Line must be set explicitly", "scatter plot with two measures", "what mark class for a pie chart", "treemap mapsources stripped on round-trip", "chart type signature table", "minimal XML for each chart type"

## When to Use

Use this module when you need to:
- **Identify a chart type** from workbook XML — look up the mark class + shelf combination
- **Write a new chart type** — get the minimal XML configuration required
- **Debug a chart that isn't rendering as expected** — cross-reference against the confirmed patterns here
- **Write a treemap** — the treemap has several non-obvious requirements (breakdown, mapsources, style-rule)

---

## Best Practices

- **`Automatic` and `Bar` are interchangeable** for the standard dimension-on-cols / measure-on-rows layout. The round-tripped XML is structurally identical. Prefer `Automatic` unless you need to lock the mark type explicitly.
- **Line must be set explicitly.** `class="Automatic"` will NOT resolve to a line chart even with a date on Cols. Always write `class="Line"`.
- **Treemap requires `breakdown="on"`.** `breakdown="auto"` with size+text encodings renders a bar chart, not a treemap. Do NOT include `<mapsources>` or `<style-rule element="size-bar">` — both are stripped on round-trip and are not needed for correct rendering.
- **Scatter with only two measures → single aggregate dot.** Add a `<lod>` dimension encoding to disaggregate to one mark per row.
- **Pie size legend is runtime-only.** A grand-total size legend appears in screenshots but nothing is written to XML — don't attempt to reproduce it via XML.

---

## Common Mistakes

1. **Using `Automatic` for Line charts**: `Automatic` never resolves to Line via XML inference. Set `class="Line"` explicitly.
2. **Treemap with `breakdown="auto"`**: Produces a bar chart. Treemap requires `breakdown="on"`.
3. **Including `<mapsources>` in treemap**: `<mapsources>` is stripped on round-trip — Tableau does not preserve it in the worksheet XML. Treemaps render correctly without it (field-tested 2026-06-25).
4. **Including the `size-bar` style-rule in submitted treemap XML**: The `<style-rule element="size-bar">` block is stripped on round-trip. Treemaps render without it; omit it from submitted XML.
5. **Assuming column-instances are needed for encoding-only fields in treemaps**: Tableau strips column-instances for fields that appear only in `<encodings>` and not on `<rows>`/`<cols>`. This is expected behavior — the encoding reference itself is sufficient.

---

## Implementation

### Mark type signature table

| Chart type | `<mark class>` | `<rows>` | `<cols>` | Key encodings | `breakdown` |
|---|---|---|---|---|---|
| Vertical bar | `Automatic` | measure CI | dimension CI | none | `auto` |
| Horizontal bar | `Automatic` | dimension CI | measure CI | none | `auto` |
| Line chart | `Line` | measure CI | date or dimension CI | none | `auto` |
| Scatter plot | `Circle` | measure CI | measure CI | none | `auto` |
| Treemap | `Automatic` | empty | empty | `<size>` (measure) + `<text>` (dimension) | **`on`** |
| Pie chart | `Pie` | empty | empty | `<size>` (measure) + `<color>` (dimension) | `auto` |
| Text table | `Text` | dimension CI | empty | `<text>` (measure) | `auto` |

**Reading direction (XML → chart type):** Check `<mark class>`, then `<rows>`/`<cols>` content, then `<encodings>`, then `breakdown` value.

**Writing direction (chart type → XML):** Use the table above as the minimal required configuration.

### Treemap XML pattern (confirmed working, field-tested 2026-06-25)

Note: `<mapsources>` and `<style-rule element="size-bar">` are both stripped by Tableau on round-trip — do not include them.

```xml
<worksheet name="Sheet 1">
  <table>
    <view>
      <datasources>
        <datasource name="Sample - Superstore"/>
      </datasources>
      <datasource-dependencies datasource="Sample - Superstore">
        <column datatype="real" name="[Sales]" role="measure" type="quantitative"/>
        <column datatype="string" name="[Category]" role="dimension" type="nominal"/>
        <column-instance column="[Sales]" derivation="Sum" name="[sum:Sales:qk]" pivot="key" type="quantitative"/>
        <column-instance column="[Category]" derivation="None" name="[none:Category:nk]" pivot="key" type="nominal"/>
      </datasource-dependencies>
      <aggregation value="true"/>
    </view>
    <style/>
    <panes>
      <pane selection-relaxation-option="selection-relaxation-allow">
        <view><breakdown value="on"/></view>
        <mark class="Automatic"/>
        <encodings>
          <size column="[Sample - Superstore].[sum:Sales:qk]"/>
          <text column="[Sample - Superstore].[none:Category:nk]"/>
        </encodings>
      </pane>
    </panes>
    <rows/>
    <cols/>
  </table>
</worksheet>
```

### Baseline bar chart XML pattern (confirmed working)

```xml
<worksheet name="Sheet 1">
  <table>
    <view>
      <datasources>
        <datasource name="Sample - Superstore"/>
      </datasources>
      <datasource-dependencies datasource="Sample - Superstore">
        <column datatype="real" name="[Sales]" role="measure" type="quantitative"/>
        <column datatype="string" name="[Category]" role="dimension" type="nominal"/>
        <column-instance column="[Category]" derivation="None" name="[none:Category:nk]" pivot="key" type="nominal"/>
        <column-instance column="[Sales]" derivation="Sum" name="[sum:Sales:qk]" pivot="key" type="quantitative"/>
      </datasource-dependencies>
      <aggregation value="true"/>
    </view>
    <style/>
    <panes>
      <pane selection-relaxation-option="selection-relaxation-allow">
        <view><breakdown value="auto"/></view>
        <mark class="Automatic"/>
      </pane>
    </panes>
    <rows>[Sample - Superstore].[sum:Sales:qk]</rows>
    <cols>[Sample - Superstore].[none:Category:nk]</cols>
  </table>
</worksheet>
```

### Pie chart XML pattern (confirmed working)

```xml
<panes>
  <pane>
    <view><breakdown value="auto"/></view>
    <mark class="Pie"/>
    <encodings>
      <size column="[Sample - Superstore].[sum:Sales:qk]"/>
      <color column="[Sample - Superstore].[none:Category:nk]"/>
    </encodings>
  </pane>
</panes>
<rows/>
<cols/>
```

### Text table XML pattern (confirmed working)

```xml
<panes>
  <pane>
    <view><breakdown value="auto"/></view>
    <mark class="Text"/>
    <encodings>
      <text column="[Sample - Superstore].[sum:Sales:qk]"/>
    </encodings>
    <style>
      <style-rule element="mark">
        <format attr="mark-labels-show" value="true"/>
      </style-rule>
    </style>
  </pane>
</panes>
<rows>[Sample - Superstore].[none:Category:nk]</rows>
<cols/>
```

Note: `mark-labels-show="true"` is required for the text values to be visible. See `encoding-inference-patterns.md` for details.

### What does NOT work

- `class="Automatic"` for line charts — resolves to bar, not line
- `breakdown="auto"` for treemaps — renders a bar chart
- `derivation="TruncYear"`, `derivation="TruncMonth"`, `derivation="TruncDay"`, `derivation="TruncQuarter"`, `derivation="TruncatedToYear"`, `derivation="TruncatedToMonth"`, `derivation="TruncatedDate"` — ALL silently rewritten to `derivation="None"`. Use `Year`, `Quarter`, `Month`, `Day` (same string for both discrete and continuous). CI prefixes: `yr:`, `qr:`, `mn:`, `dy:` for both `:ok` and `:qk` forms (field-tested 2026-06-25).
- `<mapsources>` in treemap view — **stripped on round-trip** (field-tested 2026-06-25, session 92271). The treemap renders correctly without it; `mapsources` is not required despite earlier documentation.
- `<style-rule element="size-bar">` at the table level — **stripped on round-trip** (field-tested 2026-06-25). The treemap renders without it; omit from submitted XML.

## When to Say No

This file is a technical XML reference, not authoring guidance. Do not apply these patterns to non-XML contexts (e.g. Tableau Cloud REST API, Tableau Prep, or Hyper files).

## Source and Confidence

- Source/evidence type: field-tested
- Source: Empirical XML injection + round-trip inspection via `apply-worksheet` / `get-worksheet-xml`, Tableau Desktop, Sample - Superstore datasource
- Customer-identifying details removed: yes
- Confidence: field-tested
- Last reviewed: 2026-06-25
