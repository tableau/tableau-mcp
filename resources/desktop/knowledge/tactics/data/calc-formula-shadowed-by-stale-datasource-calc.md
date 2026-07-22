# Calc Name Reuses an Existing *Calc* Name → Tableau KEEPS the STALE Formula (Wrong Result, Not Blank)

Applying a template (or authoring a calc) whose `<calculation>` column name ALREADY exists as a **calculated field** on the target datasource makes Tableau **keep the datasource's stale formula and silently discard the one you authored**. Unlike the field-collision variant, the viz is **not blank** — it renders with the WRONG numbers, which is harder to catch.

## Scope Check

- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: create, troubleshoot
- In-scope reason: A name collision between an authored calc and an existing *calc* of the same name is resolved by the loader in favor of the DATASOURCE's stale formula; the template's freshly-authored formula is dropped, so the mark computes a wrong value. Root-caused live on a template fast-path apply (2026-07-05).
- Out-of-scope risk: none
- Tags: calculated-field, calc-name-collision, calc-shadows-calc, formula-shadow, stale-formula, wrong-result, not-blank, silent-wrong-value, template-apply, calc-namespacing, per-apply-suffix, reused-calc-name, gantt, zero-span, ww-floating-bars
- Relevant user prompts/search terms: "my calc shows the wrong number after apply", "the template computed a different value than expected", "gantt bars have zero span / ticks instead of spans", "the formula didn't take effect after applying the template", "Tableau kept the old formula for my calculated field", "I reused a calc name and got stale results", "same-named calc on the datasource overrides my template calc", "apply succeeded but the calculation is wrong", "why is my calculated field using an old formula", "template fast-path renders broken but a uniquely-named copy renders fine"

## When to Use

Reach for this when a template/worksheet **applies and renders (non-blank) but the numbers are wrong**, especially when a *uniquely-named* copy of the same viz renders correctly on the SAME datasource. The tell: the target datasource already contains a calculated field with the SAME name as one the template authors.

Distinguish from the field-collision variant:

- **Calc name == a real DATA COLUMN** → loader ignores the calc entirely → **blank / no marks** → see `calc-name-collides-with-field.md`.
- **Calc name == an existing CALC** (this entry) → loader keeps the datasource's **older formula** → **renders, but wrong** (e.g. a Gantt whose size calc silently reverts to a stale definition and paints zero-span ticks).

Both are silent: the apply returns "completed"; only the render (or a diagnostic text table) reveals the defect.

## Best Practices

1. **Namespace template-internal calc names per apply.** When injecting a template, rename the template's OWN calc columns to per-apply-unique names (e.g. `Calculation_GanttSize` → `Calculation_GanttSize_tpl_<shorthash>`) consistently across the column definition, its column-instances, encodings, and any formula that references it. A stale same-named datasource calc then cannot capture the reference. This is default-on in the injector (see Implementation).
2. **Keep captions human-readable — but track a formula REBIND.** Per-apply NAME namespacing (the `_tpl_` suffix) touches only the internal `name` token; leave `caption` alone so pills stay legible. **Exception:** if the same apply also *rebinds* the formula's field-refs to different bound fields, a bracket-free caption then misnames the calc and must be re-derived — see `calc-caption-follows-formula-rebind.md`.
3. **Never rename dataset-bound fields.** Only the template's derived calc columns get suffixed; mapped data fields keep their names.
4. **Verify the render, not the status.** A "completed" apply with wrong numbers is the signature — inspect a text table of the calc, or capture the viz, before trusting a fast-path apply onto a reused datasource.

## Common Mistakes

1. **Reusing generic calc names (`Calculation_ActualScore`, `Calculation_GanttSize`, `Calculation_OverUnder`) on a scratch datasource that already carries them.** The loader keeps the datasource's older formula and drops the template's — the mark computes the stale value. This is the 2026-07-05 failure: on *Super Bowl by the Numbers* (`federated.1hsb30r126jxsx11dhd2s09ro96w`), a stale `[Calculation_ActualScore] = INT([Final])` shadowed the template's grafted `SPLIT/INT` parse; the committed `ww-floating-bars` direct-applied as **zero-span ticks**, while a clean apply with uniquely-suffixed calc names rendered **real spans with the axis extending to ~75**.
2. **Retrying the same apply.** The collision is deterministic — re-applying the same generic names re-captures the same stale formula. Namespace (or pre-clear the stale scratch calcs), don't retry.
3. **Trusting a green apply.** Non-blank + wrong ≠ success. Assuming "it rendered, so it worked" hides the shadow.

## Implementation in Tableau Desktop

WRONG — template calc reuses a name the datasource already defines as a calc:

```xml
<!-- target datasource already has: [Calculation_ActualScore] = INT([Final]) -->
<column caption='Actual Score' name='[Calculation_ActualScore]' datatype='integer' role='measure' type='quantitative'>
  <calculation class='tableau' formula='INT(SPLIT(TRIM(SPLIT([Actual Input],"-",1))," ",2)) + INT(TRIM(SPLIT([Actual Input],"-",2)))' />
</column>
<!-- → Tableau KEEPS the datasource's INT([Final]) formula; the SPLIT parse is
     discarded; the Gantt size calc that depends on it computes a stale/zero
     value → zero-span ticks (renders, but WRONG). -->
```

RIGHT — namespace the template's own calc names per apply (dataset fields untouched):

```xml
<column caption='Actual Score' name='[Calculation_ActualScore_tpl_7547f9d4]' datatype='integer' role='measure' type='quantitative'>
  <calculation class='tableau' formula='INT(SPLIT(TRIM(SPLIT([Actual Input],"-",1))," ",2)) + INT(TRIM(SPLIT([Actual Input],"-",2)))' />
</column>
<column caption='Gantt Size' name='[Calculation_GanttSize_tpl_7547f9d4]' datatype='real' role='measure' type='quantitative'>
  <calculation class='tableau' formula='[Calculation_ActualScore_tpl_7547f9d4] - [Reference Value]' />
</column>
<!-- the suffix is a shorthash of (template + per-apply nonce): deterministic for
     one apply, collision-free across sequential applies. [Reference Value] and
     other dataset fields are NEVER renamed; the caption stays 'Actual Score'. -->
```

The substitution layer does this automatically: `replaceFieldReferences` (`src/server/tools/templates.ts`) rewrites every template-internal calc name — column def, column-instances, color/size encodings, and self-referencing formula bodies — while leaving dataset-bound fields and captions alone. It is **default-on** for the `inject-template` apply path; opt out with `namespace_template_calcs: false` only after de-colliding the names yourself.

## Related Knowledge

- `tactics/data/calc-name-collides-with-field.md` — the sibling **field-collision** variant (calc name == a real data column → the calc is IGNORED → blank viz). This entry is the **calc-vs-calc** variant (stale formula kept → wrong result).
- `tactics/data/calc-caption-follows-formula-rebind.md` — the **caption** counterpart: when a formula rebind is correct but the human caption is left stale (misleading label, right math). Refines this entry's "keep captions human-readable" rule.
- `tactics/data/calc-fields.md` — calculated-field / parameter XML structure.
- `tactics/data/round-trip-normalization.md` — what Tableau rewrites/drops on load.
- `tactics/workflow/templates.md` — template injection workflow.
