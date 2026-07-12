# Tableau Encoding Inference Patterns

What Tableau actually writes to XML when a user adds an encoding via the GUI — and what it does NOT write. Use this to understand the gap between a user gesture and the resulting XML delta, and to know which things must be written explicitly vs. which are handled at runtime.

All patterns confirmed empirically via XML injection + round-trip inspection + screenshot (2026-06-25).

---

## Scope Check


- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: create, validate, troubleshoot
- In-scope reason: Empirically confirmed Tableau XML patterns that directly govern how agents correctly author worksheet XML.
- Out-of-scope risk: none
- Tags: encoding, inference, runtime, xml, side-effects, mark-labels-show, round-trip, color, size, text, lod, style-rule, automatic
- Relevant user prompts/search terms: "labels not showing despite text encoding", "what XML changes when I add color", "does Tableau write style rules for encodings", "adding encoding produces no side effects", "mark-labels-show not auto-inserted", "color legend not in XML", "size legend missing from XML", "why are my labels invisible", "encoding round-trip behavior", "Tableau inference state machine"

## When to Use

Use this module when you need to:
- **Understand what XML delta a user gesture produces** — e.g. "user added a color encoding, what changed in the XML?"
- **Know what to write explicitly** vs. what Tableau infers at render time
- **Debug why labels aren't showing** despite a `<text>` encoding being present
- **Determine whether a field you added produced side effects** that the agent needs to account for
- **Confirm that adding an encoding is safe** without risk of overwriting inferred state

---

## Best Practices

- **Encoding additions produce zero XML side effects.** Adding `color`, `size`, `text`, or `lod` to `pane > encodings` results in no other XML changes — no style-rules inserted, no breakdown changes, no column-instance additions beyond what you write. Tableau's inference state machine is entirely runtime.
- **`mark-labels-show` must be written explicitly.** Adding a `<text>` encoding does NOT activate label display. Write `mark-labels-show="true"` in `pane > style > style-rule[element=mark]` explicitly, or labels will be invisible.
- **When reading a user's workbook changes, the XML delta is minimal.** Only the `<encoding>` element and its column-instance appear. There are no bundled side-effects to parse or preserve.
- **An agent can safely overwrite a worksheet** after a user adds an encoding without risk of losing inferred state — there is none.

---

## Common Mistakes

1. **Expecting `mark-labels-show` to be auto-inserted when a text encoding is added**: It is not. Tableau does not write this back to XML. The label visibility flag must be set explicitly in the agent's XML write.
2. **Expecting side-effect style-rules after adding color or size**: None appear. No legend XML, no style modifications.
3. **Assuming the size legend node in screenshots is backed by XML**: The size legend (e.g. the grand-total bar on a Pie chart) is a pure runtime rendering artifact. Nothing is written to XML for it.

---

## Implementation

### Encoding round-trip behavior: confirmed zero side effects

| Encoding added | Action | Expected side effects | Actual XML changes |
|---|---|---|---|
| `<color>` (dimension) | Color legend appears, bars colored | Legend node written? Style rules added? | **None — zero XML side effects** |
| `<size>` (measure) | Size legend appears | Size legend written? Breakdown changed? | **None — zero XML side effects** |
| `<text>` (dimension/measure) | Labels... not visible | `mark-labels-show` inserted? | **None — labels invisible without explicit write** |
| `<lod>` (dimension) | Detail level changes | CI additions? View changes? | **None — zero XML side effects** |
| `class="Bar"` (explicit) | Visually identical to Automatic | Style differences? | **None — fully interchangeable with `Automatic`** |

### Enabling mark labels (required explicit write)

Adding a `<text>` encoding alone is not sufficient to show labels. Both the encoding AND a style node must be present:

```xml
<pane>
  <mark class="Automatic"/>
  <encodings>
    <text column="[Sample - Superstore].[none:Category:nk]"/>
  </encodings>
  <style>
    <style-rule element="mark">
      <format attr="mark-labels-show" value="true"/>
      <format attr="mark-labels-cull" value="true"/>
    </style-rule>
  </style>
</pane>
```

Without `mark-labels-show="true"`, the text encoding is accepted, round-trips cleanly, but labels are not rendered.

### What Tableau DOES infer at runtime (not in XML)

These are render-time behaviors that do NOT appear in the workbook XML:

- **Color legend** — appears when a `<color>` encoding is present; no XML node
- **Size legend** — appears when a `<size>` encoding is present; no XML node
- **Pie grand-total size legend bar** — shows e.g. "2,326,534"; no XML node
- **Automatic chart type resolution** — `class="Automatic"` with measure/dimension shelves → bar; with two measures → scatter. Resolved at render, not stored in XML.
- **Caption text** — e.g. "Details are shown for Category" when a `<lod>` encoding is added; no XML node

### What must be written explicitly (not inferred)

| Desired behavior | What to write |
|---|---|
| Show mark labels | `<format attr="mark-labels-show" value="true"/>` in `pane > style > style-rule[element=mark]` |
| Label culling (hide overlapping) | `<format attr="mark-labels-cull" value="true"/>` alongside `mark-labels-show` |
| Specific label mode | `<format attr="mark-labels-mode" value="line-ends"/>` etc. — see `marks-and-encodings.md` |
| Treemap tile sizing | `<style-rule element="size-bar"><format attr="size" value="0.5"/></style-rule>` at table `<style>` level |
| Treemap layout | `<breakdown value="on"/>` inside `<pane> > <view>` |

### `datasource-dependencies` CI ordering is normalized on round-trip

Tableau reorders `column-instance` elements inside `datasource-dependencies` alphabetically by CI name on round-trip. The order you submit is not preserved. This is cosmetic and has no functional effect, but do not rely on submission order when reading back.

### Column metadata is corrected on round-trip to match datasource knowledge

If the `<column>` attributes you submit (`datatype`, `type`, `semantic-role`) don't match what the datasource actually knows about that field, Tableau silently corrects them. Examples observed:

- `[Postal Code]` submitted as `datatype="integer" type="ordinal"` → corrected to `datatype="string" type="nominal"` with `semantic-role="[ZipCode].[Name]"` injected
- `[Returned]` submitted as `datatype="boolean"` → corrected to `datatype="string"`

**Implication:** always use the field's actual datasource metadata in column defs. Use `tableau-list-available-fields` to get correct `datatype` and `type` values rather than guessing. Submitting wrong metadata is safe (Tableau corrects it), but the round-tripped XML will differ from what you submitted.

### Simple-id uuid is always overwritten

Every `tableau-apply-worksheet` call replaces the `<simple-id uuid="..."/>` in the submitted XML with the persistent workbook identity UUID. The value submitted is ignored. Do not generate or rely on custom UUIDs in this node.

## When to Say No

This file is a technical XML reference, not authoring guidance. Do not apply these patterns to non-XML contexts (e.g. Tableau Cloud REST API, Tableau Prep, or Hyper files).

## Source and Confidence

- Source/evidence type: field-tested
- Source: Empirical XML injection + round-trip inspection via `tableau-apply-worksheet` / `tableau-get-worksheet`, Tableau Desktop, Sample - Superstore datasource
- Customer-identifying details removed: yes
- Confidence: field-tested
- Last reviewed: 2026-06-25
