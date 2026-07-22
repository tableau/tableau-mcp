# Round-trip Normalization of Calc-Field XML

What you write with `apply-workbook` is not bit-exact what `get-workbook-xml` returns. Tableau's save pass applies several idempotent normalizations to calc-field XML. Knowing them up front avoids wasted time comparing "pre-apply vs post-apply" XML and mistaking cosmetic rewrites for semantic drift.

---

## Scope Check


- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: troubleshoot, validate
- In-scope reason: Explains how Tableau rewrites calc-field XML on save so Claude can distinguish cosmetic changes from semantic failures when verifying an apply result.
- Out-of-scope risk: none
- Tags: round-trip-normalization, formula-rewrite, caption-to-internal-name, multi-line-formulas, xml-attribute-escaping, column-reordering, dependency-graph-lazy-resolution, data-pane-invalid-flash, character-references
- Relevant user prompts/search terms: "formula changed after save", "caption reference became internal name", "multi-line formula collapsed to one line", "&#10; newline in formula", "columns alphabetically reordered", "invalid datasources warning after apply", "THEN ELSEIF alignment conventions", "tabdoc:goto-sheet forces evaluation"

## 1. Caption references in formulas get rewritten to internal names on save

A formula authored as `{ FIXED [Customer ID] : SUM([Sales]) }` against a datasource where those fields have `name='[R9M_FX_CUST_K]' caption='Customer ID'` and `name='[M_Q1_SLS]' caption='Sales'` is saved as `{ FIXED [R9M_FX_CUST_K] : SUM([M_Q1_SLS]) }`. The rewrite happens on the save/validation pass after the first apply that completes validation. Same for calc-to-calc references: an authored `STR([R Quintile]) + STR([F Quintile])` becomes `STR([Calculation_<id>]) + STR([Calculation_<id>])` in the stored XML.

**Authoring guidance** (from observed UI behavior, not just XML parsing): **author with internal names directly** rather than relying on caption resolution. Caption-authored formulas can produce transient "invalid" Data-pane flags between the first apply and Tableau's full validation cycle (even when `list-available-fields` shows the calc compiled and typed correctly). Internal-name formulas are immediately canonical; no round-trip needed to stabilize.

Earlier notes in this file and elsewhere that claimed "captions are preserved verbatim" were observations from an intermediate state where the validation cycle hadn't completed; they did not reflect the eventual saved form and have been corrected.

---

## 2. Literal whitespace in a formula attribute IS collapsed — but character references survive

This is an XML 1.0 attribute-value normalization rule (Section 3.3.3), **not** a Tableau quirk. Any literal `\n`/`\r`/`\t` inside a `formula="..."` attribute value is normalized to a single space on parse. Character references for the same characters (`&#10;` for LF, `&#9;` for tab) are **not** subject to that normalization and round-trip intact through Tableau's save pass.

**Wrong** — writes literal newlines, which the XML parser collapses before Tableau ever sees them:
```python
formula = """IF [R Quintile] >= 4 THEN 'Champions'
ELSEIF [R Quintile] <= 2 THEN 'At Risk'
ELSE 'Middle' END"""
# → saved as: IF [R Quintile] >= 4 THEN 'Champions' ELSEIF [R Quintile] <= 2 THEN 'At Risk' ELSE 'Middle' END
```

**Right** — use numeric character references for structural whitespace:
```python
def esc_formula(s):
    s = s.replace("&", "&amp;").replace("<", "&lt;").replace("'", "&apos;")
    s = s.replace("\t", "&#9;").replace("\n", "&#10;")
    return s

formula = esc_formula("""// Named RFM segment derived from quintiles.
IF     [R Quintile] >= 4 AND [F Quintile] >= 4 AND [M Quintile] >= 4 THEN 'Champions'
ELSEIF [R Quintile] >= 4 AND [F Quintile] <= 2                        THEN 'New Customers'
ELSE                                                                        'Middle Tier'
END""")
# → saved with &#10; intact; Tableau's formula editor displays it multi-line with // comments.
```

Tableau's formula language uses `//` for line comments — use them liberally to explain the analytical intent (named concept, why nested LOD, why the comparison flipped, why the magic threshold). Good comments survive every round-trip and are the cheapest form of institutional memory you can leave in a workbook.

**Real-world confirmation**: multiple Tableau Public workbooks (Trellis Chart examples, etc.) use the `&#10;` pattern for multi-line formulas with `// Rows` / `// Columns` comments — search for `formula=.*&#10;` across the example corpus.

**Formatting conventions** (reverse-engineered from diffing agent-authored calcs against UI-edited versions of the same formula):

- **Break after `THEN` / `ELSE` / `ELSEIF` and indent the branch body on its own line.** Do NOT column-align branch results with horizontal padding. Example of what NOT to do:
  ```
  IF [Calculation_...500005] >= 4 AND [Calculation_...500006] >= 4 THEN 'Champions'
  ELSEIF [Calculation_...500005] >= 4 AND [Calculation_...500006] <= 2        THEN 'New Customers'
  ```
  This looks aligned when you author it, but the Tableau formula editor toggles between `[Calculation_<16 digits>]` internal names and their `[Caption]` display forms, and those have very different widths. Any column alignment you bake in with spaces will appear crooked in one of the two views. The robust form is break-after-keyword:
  ```
  IF     [Calculation_...500005] >= 4
     AND [Calculation_...500006] >= 4 THEN
      'Champions'
  ELSEIF [Calculation_...500005] >= 4
     AND [Calculation_...500006] <= 2 THEN
      'New Customers'
  ...
  ELSE
      'Middle Tier'
  END
  ```
- **Blank line (`&#10;&#10;`) between the leading comment block and the first line of code** — visual separation of documentation from logic.
- **Comments describe analytical intent, not authoring mechanics.** Good: `// Days since each customer's last order. Smaller = more recent.` Bad: `// References the Monetary (Sales) calc field by its internal Calculation_ name.` The second is a note to your past self about XML authoring; the analyst reading the calc in Tableau doesn't need it and it adds noise.
- **Single-branch `IF`s need no alignment at all** — just `IF cond THEN 'a' ELSE 'b' END` on one line if it fits, or `IF cond THEN&#10;    'a'&#10;ELSE&#10;    'b'&#10;END` if you want it vertical.

---

## 3. XML attribute quoting + character escaping is normalized

Regardless of what you wrote, Tableau re-emits attributes with single quotes and entity-escapes inline quotes and `<`/`>`:
```
# authored
formula="DATEDIFF('day', [Last Order Date], TODAY())"

# saved
formula='DATEDIFF(&apos;day&apos;, [Last Order Date], TODAY())'
```
Comparison operators inside formulas round-trip as entities: `<=` → `&lt;=`, `>=` → `&gt;=`. Idempotent after the first save.

---

## 4. `<column>` children of a datasource are alphabetically re-sorted on save

If you insert new calc-field `<column>` elements after `</object-graph>` for diff control (or anywhere else in the datasource block), Tableau will move them into alphabetical position among the existing column children. `[Calculation_2026...]` calc-field columns land in the `C…` range. This means:
- Insertion position within the datasource is advisory only.
- A diff between "workbook I just applied" and `get-workbook-xml` after apply will *always* show calc-field columns moving, even when nothing semantically changed. Compare *post-save* to *post-save* for semantic drift checks.

---

## 5. Dependency graph is built lazily; the Data pane briefly flashes "invalid" before resolution completes

When an apply introduces a multi-level calc chain (e.g. 4-deep: `RFM Tier` → `R Quintile` → `Recency (Days)` → `Last Order Date`), the Data pane UI may show an "invalid datasources" warning for a short window after the apply call has already returned success. This is a UI/metadata-service timing artifact, not a real failure. See `expertise://tableau/tactics/workflow/recovery` for how to distinguish this from an actual silent-apply-failure and the corrective action (`tabdoc:goto-sheet` forces a full evaluation cycle).

---

## 6. Removing a `<column>` via a document round-trip load is silently ignored

Live-proven (2026-07-19, Desktop main.26.0715): deleting a `<column>` node from a datasource and posting the edited document back with workbook document apply reports `completed`, but the column survives — it is NOT removed. Column ADDS and worksheet-content rewrites apply normally; column DELETES no-op silently. Do not attempt to "clean up" calc fields by round-tripping a document with the column removed — `get-workbook-xml` readback will show the column still present. There is currently no confirmed document-round-trip path to delete a calc column; treat the channel as append-only for columns until a removal path is verified.

## When to Use

Read this module when you are:
- Comparing pre-apply XML against `get-workbook-xml` output and seeing differences you didn't author (column re-ordering, attribute re-quoting, formula caption-to-internal-name rewrites).
- Authoring multi-line calc formulas and need them to display as multi-line in Tableau's formula editor.
- Debugging why a freshly-applied calc shows a red error in the Data pane even though the formula validates.
- Building diff-based regression checks that need to compare semantically meaningful changes (compare *post-save* to *post-save*, not *pre-apply* to *post-save*).

For calc-field authoring fundamentals (column structure, parameters, table calcs), see `expertise://tableau/tactics/data/calc-fields`.

---

## Best Practices

- **Author formulas with internal names** (`SUM([M_Q1_SLS])`), not captions (`SUM([Sales])`). Internal-name formulas are immediately canonical; caption-authored formulas can transiently flag invalid in the Data pane until Tableau's validation cycle completes.
- **Use `&#10;` (newline character reference) — never literal `\n`** — inside `formula="..."` attributes for multi-line formulas. Literal whitespace is collapsed by the XML parser before Tableau ever sees it.
- **Always compare post-save to post-save for semantic-drift detection.** The first save normalizes attribute quoting, formula text, and column ordering; comparing pre-apply to post-save will surface cosmetic differences as false positives.
- **Use Tableau formula `//` comments to capture analytical intent.** They round-trip through every save and are the cheapest form of institutional memory.

---

## Common Mistakes

1. **Pasting a multi-line Python triple-quoted formula directly into `formula="..."`.** XML attribute normalization collapses the literal newlines to single spaces; Tableau receives a single-line formula and the formula editor renders it on one line. Use `&#10;` instead.
2. **Comparing pre-apply XML to `get-workbook-xml` output and panicking at the diff.** Tableau will reorder `<column>` children alphabetically, rewrite `formula='...'` attribute quoting, and substitute `&apos;` for inline single quotes. None of those are semantic changes. Compare two consecutive `get-workbook-xml` outputs instead.
3. **Authoring calc names with custom strings** (`[R Score]`, `[Is Selected Genre]`) instead of `[Calculation_<digits>]`. The XML parser accepts the column but Tableau's formula-validation UI flags the field "invalid" in the Data pane.
4. **Authoring formulas with caption references and assuming they survive.** They get rewritten to internal names on the next save pass. Author with internal names from the start to avoid the transient "invalid" flag.
5. **Treating the Data pane's "invalid datasources" warning as fatal.** For multi-level calc chains it's usually a transient lazy-resolution artifact. Force evaluation with `tabdoc:goto-sheet` or wait for the validation cycle (a few seconds) before declaring failure.

---

## Implementation

1. **Always escape formula text before injecting into XML.** A small helper:
   ```python
   def esc_formula(s):
       s = s.replace("&", "&amp;").replace("<", "&lt;").replace("'", "&apos;")
       s = s.replace("\t", "&#9;").replace("\n", "&#10;")
       return s
   ```
2. **Use `[Calculation_<digits>]` internal names** for calc-field column `name` attributes (single underscore, contiguous run of digits). Move human-readable labels to the `caption` attribute.
3. **Reference fields in formulas by internal name** (the column's `name` attribute, with surrounding brackets), not by caption.
4. **For diff-based validation pipelines:** snapshot the workbook with `get-workbook-xml` immediately after every apply, then diff snapshot N against snapshot N+1. Differences that appear only in pre-apply-vs-post-save are normalization artifacts and should be filtered out.
5. **For multi-level calc chains, expect a brief "invalid" Data-pane flash after apply.** Either wait for resolution to complete or force it with a `tabdoc:goto-sheet` round-trip before treating the warning as a real failure.

## Source and Confidence

- Source/evidence type: field-tested
- Source: Observed Tableau XML rewrite behavior on apply/save; provenance not fully attested post-IA-migration
- Customer-identifying details removed: yes
- Confidence: needs review
- Last reviewed: 2026-07-02
