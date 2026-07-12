# Calc Name Collides With a Datasource Field → Tableau IGNORES the Calc (Blank Viz)

Naming a calculated field the SAME as an existing datasource field makes Tableau **silently ignore the calc** on load — the viz then references a field that isn't what you authored, and renders BLANK.

## Scope Check

- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: create, troubleshoot
- In-scope reason: A name collision between an authored calc and a real datasource field is silently dropped by the loader; the agent's viz references the ghost calc and renders nothing. Root-caused live (WOW2026 W23, 2026-07-03).
- Out-of-scope risk: none
- Tags: calculated-field, calc-name-collision, duplicate-field-name, field-already-defined, blank-viz, blank-chart, no-marks, ignoring-calculated-field, already-defined-by-data-source, name-clash, rename-calc, load-warning, silent-drop, calc-shadows-field
- Relevant user prompts/search terms: "Ignoring calculated field, field is already defined by data source", "the chart is completely blank, no bars, no marks", "my calc isn't being created", "field is already defined by data source", "I made a calc with the same name as a field", "calculated field disappeared after apply", "why is my worksheet blank after adding a calc", "warnings occurred while loading the workbook calculated field ignored", "calc named the same as a column", "renamed field collides with calc", "duplicate name calc and field"

## When to Use

Reach for this the moment an apply "succeeds" but the worksheet renders **blank / no marks**, and the Tableau load log (or a Desktop modal) says:

> `Ignoring calculated field '[<Name>]', field is already defined by data source.`

The cause is a **name collision**: you authored a `<column>` with a `<calculation>` whose `name`/`caption` matches a field that ALREADY exists in the connected datasource (e.g. authoring a calc `[O/U Line]` when the CSV already has an `O/U Line` column). The loader keeps the original datasource field and **drops your calc entirely** — so anything on a shelf that expected your calc's formula binds to nothing (or to the raw field), and the mark count is zero.

This is a SILENT class: the apply returns "completed" with only a *warning*, so transcript-based failure detection misses it — the tell is the blank render plus the load warning.

## Best Practices

1. **Give the calc a distinct name.** If you need a derived version of an existing field `[X]`, name the calc clearly differently: `[X (calc)]`, `[X Adjusted]`, `[X Ratio]` — never the bare existing field name `[X]`.
2. **Reference the existing field directly when no transform is needed.** If the datasource already has field `[X]`, put `[X]` on the shelf as-is — do NOT wrap it in a same-named calc.
3. **Check the datasource's fields before authoring calcs.** List the real column names first; treat them as reserved.
4. **After an apply, if the render is blank, read the load warnings** for "already defined by data source" before re-trying — re-applying the same collision just reproduces the blank.

## Common Mistakes

1. **Authoring `[Field] = <formula>` where `[Field]` is a real datasource column.** Tableau ignores the calc; the shelf reference resolves to the raw field (or nothing) → blank or wrong viz. This is the WOW2026 W23 failure: a calc named `[O/U Line]` collided with the CSV's `O/U Line`, the viz went blank, and repeated re-applies kept reproducing it.
2. **Retrying without renaming.** The collision is deterministic — the same name collides every time. Rename, don't retry.
3. **Assuming "apply completed" means it worked.** A load *warning* (not error) still ignores the calc; success + blank render = suspect a collision.

## Implementation in Tableau Desktop

WRONG — calc name shadows an existing datasource field (silently dropped):

```xml
<!-- datasource already has a column named 'O/U Line' -->
<column caption='O/U Line' name='[O/U Line]' datatype='real' role='measure' type='quantitative'>
  <calculation class='tableau' formula='[Final] - [Betting Line]' />
</column>
<!-- → load warning: "Ignoring calculated field '[O/U Line]', field is already defined
     by data source."  The calc never exists; a shelf using it renders blank. -->
```

RIGHT — distinct name (the calc is created and usable):

```xml
<column caption='O/U Diff' name='[O/U Diff]' datatype='real' role='measure' type='quantitative'>
  <calculation class='tableau' formula='[Final] - [O/U Line]' />
</column>
<!-- references the REAL datasource field [O/U Line]; the new calc [O/U Diff] has a unique name. -->
```

Or, if no transform is needed, skip the calc and put the datasource field on the shelf directly.

## Related Knowledge

- `tactics/data/calc-formula-shadowed-by-stale-datasource-calc.md` — the sibling **calc-vs-calc** variant: reusing a name that already exists as a *calc* keeps the datasource's STALE formula (renders, but WRONG) instead of dropping to blank.
- `tactics/data/calc-fields.md` — calculated-field / parameter XML structure.
- `tactics/data/round-trip-normalization.md` — what Tableau rewrites/drops on load.
