# Column Instance Name Prefixes — Empirically Confirmed

Complete authoritative mapping of `derivation` attribute values → CI name prefixes for all known derivation types. Field-tested via XML injection + round-trip inspection (2026-06-25).

**Note:** `enums.md` lists several derivation strings that are wrong or incomplete — use THIS file as the authoritative source for derivation strings and CI prefixes. Specific corrections to `enums.md` are noted in the table below.

---

## Scope Check


- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: create, validate, troubleshoot
- In-scope reason: Empirically confirmed Tableau XML patterns that directly govern how agents correctly author worksheet XML.
- Out-of-scope risk: none
- Tags: derivation-prefixes, column-instance-naming, aggregation-switch, date-derivations, measure-aggregations, table-calc-user-derivation, ci-name-format, shelf-notation, disambiguation-suffix, invalid-derivation-rewrites
- Relevant user prompts/search terms: "derivation attribute to CI prefix mapping", "Attr invalid rewrites to None", "TruncYear TruncMonth invalid strings", "cntd: wrong prefix use ctd:", "shelf operator star slash plus notation", "same field twice disambiguation suffix", "Year-Trunc not TruncatedToYear", "switch aggregation Sum to Avg XML", "StdevP prefix stp: not stdevp:"

## When to Use

Use this module when you need to:
- **Write a column-instance** — look up the correct `derivation` string and CI name prefix
- **Read a workbook's CI names** — identify what derivation they represent
- **Switch a measure's aggregation** — know exactly which XML nodes change
- **Avoid silent rewrites** — several derivation strings look plausible but are invalid and silently rewrite to `None`
- **Write shelf expressions** — know the `*`/`/`/`+` notation for multiple fields on a shelf
- **Handle same-field-twice** — understand the `:N` disambiguation suffix

---

## Best Practices

- **Derivation is authoritative, not the CI name prefix.** If you get the derivation right but the prefix wrong, Tableau rewrites the name to match. If you get the derivation wrong, Tableau rewrites both to `None` — the prefix alone cannot rescue an invalid derivation.
- **Use the exact derivation strings in this table.** Several look-alike strings are invalid: `Attr` (not `Attribute`), `TruncMonth` (not `Month-Trunc`), `cntd:` (not `ctd:`). All silently rewrite to `None` with no error.
- **When switching aggregations, only the column-instance changes.** The column def's `datatype` and `type` reflect the field's native type and do not change when aggregation changes.
- **Update all references when changing a CI name** — `<rows>`, `<cols>`, and any encoding `column` attributes that reference the old CI name.

---

## Common Mistakes

1. **`Attr` instead of `Attribute`** — `Attr` silently rewrites to `None`.
2. **`TruncYear` / `TruncMonth` / `TruncDay`** — all silently rewrite to `None`. Correct strings are `Year-Trunc`, `Month-Trunc`, `Day-Trunc`.
3. **`cntd:` prefix for CountD** — Tableau rewrites to `ctd:`. Always use `ctd:`.
4. **`stdev:` prefix for Stdev** — correct prefix is `std:`.
5. **`stdevp:` or `stdp:` prefix for StdevP** — correct prefix is `stp:`.
6. **`varp:` prefix for VarP** — correct prefix is `vrp:`.
7. **Modifying the column def when switching aggregation** — `datatype` and `type` on the column def do not change. Only the CI changes.

---

## Implementation

### Complete derivation → CI prefix table

#### Dimension derivations

| Derivation string | CI prefix | `:nk`/`:ok`/`:qk` | Notes |
|---|---|---|---|
| `None` | `none:` | `:nk` (nominal) for string/boolean dimensions; `:ok` or `:qk` for date "Exact Date" | Exact Date supports both discrete (`:ok`) and continuous (`:qk`) |
| `Attribute` | `attr:` | `:ok` discrete, `:qk` continuous | `Attr` is INVALID — silently rewrites to `None` |

#### Date part derivations (discrete or continuous)

Same derivation string for both `:ok` (discrete) and `:qk` (continuous) — only the suffix and `type` attr differ. All can be set to either discrete or continuous regardless of their default.

| Derivation string | CI prefix | Example discrete | Example continuous | Notes |
|---|---|---|---|---|
| `Year` | `yr:` | `[yr:Order Date:ok]` | `[yr:Order Date:qk]` | |
| `Quarter` | `qr:` | `[qr:Order Date:ok]` | `[qr:Order Date:qk]` | |
| `Month` | `mn:` | `[mn:Order Date:ok]` | `[mn:Order Date:qk]` | |
| `Week` | `wk:` | `[wk:Order Date:ok]` | `[wk:Order Date:qk]` | |
| `Weekday` | `wd:` | `[wd:Order Date:ok]` | — | datepart only (no truncation form); discrete only |
| `Day` | `dy:` | `[dy:Order Date:ok]` | `[dy:Order Date:qk]` | |
| `Hour` | `hr:` | `[hr:Order Date:ok]` | `[hr:Order Date:qk]` | requires `datetime`; default: discrete |
| `Minute` | `mi:` | `[mi:Order Date:ok]` | `[mi:Order Date:qk]` | requires `datetime`; default: discrete |
| `Second` | `sc:` | `[sc:Order Date:ok]` | `[sc:Order Date:qk]` | requires `datetime`; default: discrete |
| `MY` | `my:` | `[my:Order Date:ok]` | — | "Month / Year" combined display; datepart only; discrete only |
| `MDY` | `md:` | `[md:Order Date:ok]` | — | "Month / Day / Year" combined display; datepart only; discrete only |
| `ISO-Year` | `iyr:` | `[iyr:Order Date:ok]` | `[iyr:Order Date:qk]` | ISO 8601 week-numbering year (week containing Thu defines the year) |
| `ISO-Qtr` | `iqr:` | `[iqr:Order Date:ok]` | `[iqr:Order Date:qk]` | ISO quarter (relative to ISO year); default: discrete |
| `ISO-Week` | `iwk:` | `[iwk:Order Date:ok]` | `[iwk:Order Date:qk]` | ISO 8601 week number (1–53); default: discrete |
| `ISO-Weekday` | `iwd:` | `[iwd:Order Date:ok]` | — | ISO weekday (Mon=1 … Sun=7); datepart only; discrete only |

#### Date truncation derivations (truncate to period start — keeps year context)

Truncations round to the start of a period, producing a date/datetime value. Default: continuous. All can be set to either discrete or continuous.

| Derivation string | CI prefix | Example discrete | Example continuous | Notes |
|---|---|---|---|---|
| `Year-Trunc` | `tyr:` | `[tyr:Order Date:ok]` | `[tyr:Order Date:qk]` | `TruncYear` / `TruncatedToYear` are INVALID |
| `ISO-Year-Trunc` | `tiyr:` | `[tiyr:Order Date:ok]` | `[tiyr:Order Date:qk]` | ISO 8601 week-numbering year truncation |
| `Quarter-Trunc` | `tqr:` | `[tqr:Order Date:ok]` | `[tqr:Order Date:qk]` | `TruncQuarter` is INVALID |
| `ISO-Qtr-Trunc` | `tiqr:` | `[tiqr:Order Date:ok]` | `[tiqr:Order Date:qk]` | ISO quarter truncation |
| `ISO-Week-Trunc` | `tiwk:` | `[tiwk:Order Date:ok]` | `[tiwk:Order Date:qk]` | ISO week truncation |
| `Month-Trunc` | `tmn:` | `[tmn:Order Date:ok]` | `[tmn:Order Date:qk]` | `TruncMonth` / `TruncatedToMonth` are INVALID |
| `Week-Trunc` | `twk:` | `[twk:Order Date:ok]` | `[twk:Order Date:qk]` | |
| `Day-Trunc` | `tdy:` | `[tdy:Order Date:ok]` | `[tdy:Order Date:qk]` | `TruncDay` / `TruncatedToDay` are INVALID |
| `Hour-Trunc` | `thr:` | `[thr:Order Date:ok]` | `[thr:Order Date:qk]` | requires `datetime` datatype |
| `Minute-Trunc` | `tmi:` | `[tmi:Order Date:ok]` | `[tmi:Order Date:qk]` | requires `datetime` datatype |
| `Second-Trunc` | `tsc:` | `[tsc:Order Date:ok]` | `[tsc:Order Date:qk]` | requires `datetime` datatype |

#### Measure aggregation derivations

| Derivation string | CI prefix | Example | Notes |
|---|---|---|---|
| `Sum` | `sum:` | `[sum:Sales:qk]` | |
| `Avg` | `avg:` | `[avg:Sales:qk]` | |
| `Count` | `cnt:` | `[cnt:Sales:qk]` | |
| `CountD` | `ctd:` | `[ctd:Sales:qk]` | NOT `cntd:` |
| `Median` | `med:` | `[med:Sales:qk]` | |
| `Min` | `min:` | `[min:Sales:qk]` | |
| `Max` | `max:` | `[max:Sales:qk]` | |
| `Stdev` | `std:` | `[std:Sales:qk]` | NOT `stdev:` |
| `StdevP` | `stp:` | `[stp:Sales:qk]` | NOT `stdevp:` or `stdp:` |
| `Var` | `var:` | `[var:Sales:qk]` | |
| `VarP` | `vrp:` | `[vrp:Sales:qk]` | NOT `varp:` |

#### Table calc derivation

| Derivation string | CI prefix | Example | Notes |
|---|---|---|---|
| `User` | `usr:` | `[usr:Calculation_INDEX:qk]` | Requires a calculated field (not a native datasource field). Tableau auto-injects `<table-calc ordering-type="Rows"/>` on both `<column>` and `<column-instance>` |

### Derivation takes precedence over CI name prefix

If derivation and prefix are inconsistent, Tableau resolves by derivation:
- **Valid derivation + wrong prefix** → Tableau rewrites the name to match the derivation. No functional harm.
- **Invalid derivation + any prefix** → Tableau rewrites both derivation and name to `None`. Chart renders with no aggregation/truncation applied.

### Aggregation switch — which nodes change

When switching a measure's aggregation (e.g. Sum → Avg):

**Changes:**
- `column-instance` `derivation` attribute
- `column-instance` `name` attribute (prefix)
- All shelf references (`<rows>`, `<cols>`) and encoding `column` attributes pointing to the old CI name

**Does NOT change:**
- `column` def `datatype`, `role`, `type`
- `breakdown` value
- Any style rules

### Shelf expression notation for multiple fields

Shelf elements (`<rows>` / `<cols>`) use structural operators to combine multiple CIs. These have no mathematical meaning:

| Situation | Operator | Example |
|---|---|---|
| Multiple different fields on the same shelf | `*` (Rows) / `/` (Cols) | Rows: `([Category] * [sum:Sales:qk])` · Cols: `([yr:Date:ok] / [qr:Date:ok])` |
| Same field placed twice on a shelf | inner group with `+` | `([Category] * ([sum:Sales:qk] + [sum:Sales:qk:2]))` |

- `*` separates fields on the **Rows** shelf
- `/` separates fields on the **Cols** shelf
- `+` groups two instances of the **same field** within one shelf

### CI name disambiguation suffix (`:N`)

When the same base field appears multiple times on the same shelf, Tableau appends `:N` to the CI name to disambiguate: `[cum:sum:Sales:qk:2]`, `[usr:Calc:qk:3]`, etc.

- The suffix counter starts at `:2` for the second instance (`:1` is also observed for column-dominant `ordering-type` values — see `expertise://tableau/tactics/data/table-calcs`).
- The suffix has no semantic meaning.
- Tableau automatically updates shelf (`<rows>` / `<cols>`) references to match the suffix it assigns — agents do not need to manage suffixes manually.
- When submitting XML without a suffix, Tableau assigns the appropriate suffix on round-trip and updates all shelf references to match.

### `datasource-dependencies` CI ordering is normalized on round-trip

Tableau reorders `column-instance` elements alphabetically by CI name. Submission order is not preserved. Cosmetic only — no functional effect.

### Column metadata is corrected on round-trip

If submitted `<column>` attributes (`datatype`, `type`, `semantic-role`) don't match the datasource's knowledge of the field, Tableau silently corrects them. Use `tableau-list-available-fields` to get correct metadata rather than guessing.

## When to Say No

This file is a technical XML reference, not authoring guidance. Do not apply these patterns to non-XML contexts (e.g. Tableau Cloud REST API, Tableau Prep, or Hyper files).

## Source and Confidence

- Source/evidence type: field-tested
- Source: Empirical XML injection + round-trip inspection via `tableau-apply-worksheet` / `tableau-get-worksheet`, Tableau Desktop, Sample - Superstore datasource
- Customer-identifying details removed: yes
- Confidence: field-tested
- Last reviewed: 2026-06-25
