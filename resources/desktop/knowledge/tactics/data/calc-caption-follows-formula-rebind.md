# Calc Caption Must Follow a Formula Rebind → a Human Caption Left Untouched Becomes a Lie

When a template calc's FORMULA field-refs are remapped during apply (template field → the user's actual bound field), the calc's **human-readable `caption` must be updated too** — otherwise the caption keeps naming the OLD fields while the formula now computes over the NEW ones. The apply "completes," the math is correct, but the label lies. Two calcs can even end up with the **same caption and different formulas**.

## Scope Check

- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: create, troubleshoot
- In-scope reason: A calc column carries both a `<calculation formula>` and a human `caption`. When field-reference rewriting remaps the formula's inputs to different bound fields, a caption with no bracket token is left verbatim by the auto-name path, so the visible name no longer matches the math. Root-caused live from a Ben Hart dogfood repro (2026-07-10).
- Out-of-scope risk: none
- Tags: calculated-field, calc-caption, caption-stale, formula-rebind, field-ref-rewrite, misleading-label, duplicate-caption, profit-ratio, template-apply, correlation-scatter, heatmap, per-apply-namespacing, honest-caption
- Relevant user prompts/search terms: "two fields with the same name but different formulas", "the heatmap color and text are different calculations both called the same thing", "calc caption says Profit Ratio but the formula divides by Discount", "template calc label is wrong after binding to my data", "why do I have two Profit Ratio fields", "the calculated field name doesn't match its formula after apply", "caption not updated when formula rebound"

## When to Use

Reach for this when a template applies onto the user's data and the calc **renders with correct math but a misleading name** — most visibly, two calcs sharing one caption with divergent formulas (the Ben Hart *Profit Ratio* repro: one calc `SUM([Profit])/SUM([Sales])`, another `SUM([Profit])/SUM([Discount])`, both captioned `Profit Ratio`, one on the heatmap color and one on its text).

Distinguish from the two shadow variants:

- **Formula is DROPPED, stale one kept** (calc-name == existing calc) → renders, wrong math → `calc-formula-shadowed-by-stale-datasource-calc.md`.
- **Calc IGNORED entirely** (calc-name == real data column) → blank viz → `calc-name-collides-with-field.md`.
- **This entry** → formula is CORRECT (field-refs were rebound as intended) but the **caption** was left naming the pre-rebind fields → misleading label, not wrong numbers.

The tell that separates this from the shadow variants: the math is right; only the human name is wrong.

## Best Practices

1. **When a formula's field-refs are remapped, re-derive the caption in lockstep** — but ONLY for captions that are safe to rewrite. Skip captions that already carry a `[` bracket token (those are handled by the auto-name caption path); act on bracket-free human captions like `Profit Ratio`.
2. **Derive honestly, in priority order:** (a) whole-word-replace the old field names with the new inside the existing caption (`Profit / Sales` → `Profit / Discount`); else (b) humanize the rewritten formula if it's short and plain (strip `AGG([X])`→`X`, drop brackets, space operators) — `SUM([Profit])/SUM([Discount])` → `Profit / Discount`; else (c) append the distinct new field names in parens to the original caption (`Profit Ratio (Discount)`) rather than fabricate a name.
3. **Identity binds keep their caption.** If nothing was remapped (the template field bound to the same-named field), leave the caption verbatim — do not churn it.
4. **This REFINES the "keep captions human-readable" rule** from `calc-formula-shadowed-by-stale-datasource-calc.md`. Per-apply NAME namespacing (the `_tpl_<hash>` suffix) still must not touch the caption. But that rule assumed the formula's meaning was unchanged. A formula *rebind* changes the meaning, so the caption is no longer a safe human constant — it must track the rebind.

## Common Mistakes

1. **Leaving a bracket-free caption verbatim after a rebind.** `caption='Profit Ratio'` on a template calc whose formula was `SUM([Profit])/SUM([Sales])` and got rebound to `SUM([Profit])/SUM([Discount])`. The apply completes; the field now measures profit-over-discount but still reads "Profit Ratio". On a chart that uses the template's original calc AND the rebound one (heatmap color vs. text), you get two "Profit Ratio" fields with different math — "not something I'd call correct, but within the normal range of wrong" (Ben Hart, 2026-07-10).
2. **Over-rewriting the caption on an identity bind.** If Sales bound to Sales, do not touch `Profit Ratio` — deriving a caption when nothing changed just churns labels.
3. **Rewriting a caption that already contains `[` brackets here.** Those are auto-named captions that mirror formula syntax; they're owned by the separate bracket-caption path. Touching them from the rebind path double-rewrites.

## Implementation in Tableau Desktop

WRONG — formula rebound, caption left stale (produces the duplicate-name defect):

```xml
<!-- template calc, before apply: -->
<column caption='Profit Ratio' name='[Calculation_l]' role='measure' type='quantitative'>
  <calculation class='tableau' formula='SUM([Profit])/SUM([Sales])' />
</column>
<!-- user binds Sales -> Discount. Formula field-refs are remapped correctly,
     but the caption is left verbatim: -->
<column caption='Profit Ratio' name='[Calculation_l]' role='measure' type='quantitative'>
  <calculation class='tableau' formula='SUM([Profit])/SUM([Discount])' />
</column>
<!-- → correct math, misleading label. Alongside the template's original
     Profit Ratio, the data pane / heatmap now shows two 'Profit Ratio' calcs. -->
```

RIGHT — caption tracks the rebind:

```xml
<column caption='Profit / Discount' name='[Calculation_l]' role='measure' type='quantitative'>
  <calculation class='tableau' formula='SUM([Profit])/SUM([Discount])' />
</column>
<!-- caption derived: humanized rewritten formula 'Profit / Discount' (short, plain).
     Had the original caption been e.g. 'Profit / Sales', whole-word replace would
     yield 'Profit / Discount' directly. On an identity bind, caption stays verbatim. -->
```

The substitution layer does this automatically: in `replaceFieldReferences` (`src/lockstep-core/fieldReferenceRewriter.ts`, step "3b"), after `rewriteFormulaFieldRefs` changes a `<calculation formula>`, `deriveRemappedCalcCaption` recomputes the owning column's `caption` when it has no `[` token, via the three-tier derivation above; it returns `null` (no change) when nothing was remapped. This runs before the pre-existing bracket-caption path ("3b-ii"), which only touches `[..]`-bearing captions — the two are non-overlapping. Confirmed against the `correlation-scatter-plot-chart.xml` template (regression: `src/server/tools/templates.test.ts`, "calc caption follows formula rebind (Ben test1 regression)").

**What does NOT work / residual gap:** an identity bind onto a datasource that ALREADY carries an equivalent calc still produces a harmless duplicate caption — correct math, confusing label — because per-apply namespacing always mints a fresh `_tpl_` calc instead of detecting and reusing an existing equivalent one. That's a deliberate post-MVP deferral (it conflicts with the anti-shadow rename's purpose and needs formula-equivalence detection), not covered by this fix.

## Related Knowledge

- `tactics/data/calc-formula-shadowed-by-stale-datasource-calc.md` — the per-apply NAME-namespacing sibling; its "keep captions human-readable" best practice is refined by THIS entry for the rebind case.
- `tactics/data/calc-name-collides-with-field.md` — calc name == data column → blank viz.
- `tactics/data/calc-fields.md` — calc / parameter XML structure; formulas reference internal names, the UI displays captions.
- `tactics/workflow/templates.md` — template injection workflow.
