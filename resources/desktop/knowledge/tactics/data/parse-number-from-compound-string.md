# Parse Numbers Out of a Compound String Field — SPLIT/REGEXP, don't INT() the whole thing

A field like `"PHI 40-22"` or `"SEA -4.5"` is a STRING holding numbers mixed with text. `INT()`/`FLOAT()` on the whole value returns NULL/0 (it can't cast the text), so any calc built on it silently computes to zero — e.g. a Gantt bar sized by it renders as a flat TICK, not a span.

## Scope Check

- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: calculate, troubleshoot
- In-scope reason: Casting a compound/embedded-number string with INT()/FLOAT() yields NULL/0; the number must be SPLIT/REGEXP-extracted first. A calc that quietly computes to 0 makes bars flat, totals wrong, sizes invisible — with no error. Root-caused live (WOW2026 W23 gantt, 2026-07-03).
- Out-of-scope risk: none
- Tags: string-parsing, split, regexp-extract, compound-field, embedded-number, int-of-string, float-of-string, cast-string-to-number, null-calc, zero-calc, flat-bars, gantt-tick, score-string, extract-number, tokenize-field
- Relevant user prompts/search terms: "my bars are flat / just ticks", "gantt bar has no length", "gantt bars are flat ticks with no length", "calc computes to zero", "INT of a string returns null", "extract the number from a text field", "parse the score out of a string like PHI 40-22", "field is 'TEAM 40-22', I need the total points", "split a field on a space or dash", "cast a string with text in it to a number", "my measure is 0 for every row", "why is my calculated field null", "get the digits out of a mixed text field"

## When to Use

Reach for this when a field holds a number **embedded in text** — a score `"PHI 40-22"`, a spread `"SEA -4.5"`, a label `"$1,234 / mo"`, an ID `"REG-0042"` — and you need the numeric part in a calc. The trap: `INT([Final])` / `FLOAT([Field])` on the whole compound string does NOT parse it — Tableau can't cast `"PHI 40-22"` to a number, so it returns NULL (or 0 in an arithmetic context). Every downstream calc then silently reads 0: sizes collapse to ticks, totals read zero, sorts break — with **no error message** (the tell is a viz that renders but is flat/empty/wrong).

## Best Practices

1. **SPLIT out the piece(s), THEN cast.** `INT(TRIM(SPLIT([Field], " ", 2)))` grabs the 2nd space-delimited token and casts THAT. Split on the actual delimiter (space, `-`, `/`, `,`).
2. **For "A B-C" score strings, split twice.** e.g. total = `INT(SPLIT(SPLIT([Final]," ",2),"-",1)) + INT(SPLIT(SPLIT([Final]," ",2),"-",2))` — pull the `"40-22"`, then each side, then add.
3. **Or REGEXP_EXTRACT the digits.** `INT(REGEXP_EXTRACT([Field], '(\d+)'))` for the first number; `REGEXP_EXTRACT_NTH` for the Nth.
4. **Verify the calc is non-null on real rows** before building on it — if a bar/size/total looks flat or zero, check whether the source is a compound string you cast without parsing.

## Common Mistakes

1. **`INT([CompoundString])` / `FLOAT([CompoundString])`.** Returns NULL/0 on `"PHI 40-22"`. This is the WOW2026 W23 gantt failure: a bar sized by `INT([Final]) - [O/U Line]` computed to ~`0 - line` for every row, so the "floating" bars rendered as flat ticks with no visible span.
2. **Casting before splitting.** The cast must wrap the SPLIT result, not the raw field.
3. **Assuming a rendered viz is correct.** A zero/null calc still draws marks (just flat/empty) — no error fires. Inspect the calc's values, not just "did it render."

## Implementation in Tableau Desktop

WRONG — casting the whole compound string (returns NULL/0, bars go flat):

```
Total Points = INT([Final])            // [Final] = "PHI 40-22" → NULL → arithmetic reads 0
```

RIGHT — SPLIT to the numeric token, then cast (and for "A 40-22", split twice + add):

```
Score Part   = SPLIT([Final], " ", 2)                       // "40-22"
Winning Pts  = INT( SPLIT([Score Part], "-", 1) )           // 40
Losing Pts   = INT( SPLIT([Score Part], "-", 2) )           // 22
Total Points = [Winning Pts] + [Losing Pts]                 // 62  (usable in a Gantt size / axis)
```

Or with regex:

```
Total-ish    = INT( REGEXP_EXTRACT([Final], '(\d+)') )      // first number in the string
```

## Related Knowledge

- `tactics/data/calc-function-reference.md` — SPLIT / REGEXP_EXTRACT function signatures.
- `tactics/data/calc-name-collides-with-field.md` — another silent calc failure (name collision → ignored).
