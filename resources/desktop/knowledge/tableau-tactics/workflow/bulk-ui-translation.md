# Bulk UI Translation of a Workbook (Three-Layer Text Model)

Search terms: "translate the workbook into German"; "translate all visible text"; "tooltips didn't get translated"; "labels split across runs"; "don't rename my calculated fields"; "keep Controlling untranslated"; "use real umlauts not ae/oe"; "translate dashboard text zones".

Tags: translation, localization, i18n, tooltip, customized-label, customized-tooltip, dashboard-text-zone, caption, desc, run, formatted-text, umlaut, loanword, exact-tag-replacement, per-worksheet-roundtrip, hidden-by-user

## When to Use

Use this when a user asks to translate, or bulk-rewrite, all visible text in an open Tableau Desktop workbook. A naive "translate every text string" pass reliably misses the tooltips and on-canvas text of visuals, because that text does not live where a chart title does. Visible text lives in **three layers that behave differently**, and only two of them are safe to edit directly.

## Best Practices

### The three text layers

1. **Dashboard zones** — static `<text>` zones and button `<caption>` elements, in each dashboard's XML via `get-dashboard-xml`. **Safe to edit directly.**
2. **Worksheet on-canvas text** — `<customized-label>` (chart captions) and `<customized-tooltip>` (hover text) inside each worksheet's `<pane>` via `get-worksheet-xml`. **Safe to edit directly.**
3. **Calculated-field / parameter captions and descriptions** — the `<column caption="...">` attributes and their `<desc>` formula-documentation blocks. This is the **data-dictionary layer**. Editing a `caption` renames the field everywhere it is referenced (every tooltip, legend, and Analysis-pane entry that names it). **Not a cosmetic edit — flag, do not translate silently.**

### Split-run coordination (German compounds)

A single on-screen phrase is often stored as 2-3 separate `<run>` elements, each on its own line (for example, `Working` on one run, `Capital` on the next). Translate the phrase as a **coordinated whole**, not run-by-run: German compounds do not split at the same word boundary (Working Capital -> Betriebskapital / Umlaufvermögen, one word, not two). Decide the full translation first, then decide how to distribute it back across the runs.

### Match the literal string exactly

Replacement is a literal-string swap. Preserve exact leading/trailing whitespace, tabs (`\t`), and embedded newlines (`\n`) inside a run's text. A label stored as `"\tTotal Sales"` must be matched including its leading tab, or the replacement silently no-ops and the text is left in the source language.

### Guardrails before you translate anything

- **Skip `hidden-by-user='true'`** zones and panes — they are invisible template/documentation content, not worth the edit risk.
- **Ask which sections (if any) are off-limits** (for example, a section about to be rebuilt or replaced) before touching them.
- **Leave standard German business loanwords unchanged** even though they are English-spelled: `Controlling`, `ESG`, `Call Center`, `Control Tower`, `Cockpit`, `Material`, `Inflation`, `Start`. These are normal German business usage, not translation gaps.
- **Use real UTF-8 umlauts** (`ä ö ü ß`), never ASCII substitutes like `ae` / `oe` / `ss`.

### When to Say No

Layer 3 (calculated-field / parameter `caption` + `<desc>`) is **refuse-first**. When you find translatable text there, do not translate it in the same pass. List each one, explain that changing a `caption` is a workbook-wide field RENAME affecting every reference to that field, and get explicit sign-off before touching any of them. Report them separately from the safe layer-1/layer-2 edits you applied.

## Common Mistakes

- **Stopping at chart/dashboard titles.** The tooltips and on-canvas labels are the text most often missed — they are the reason a "translate everything" pass looks done but isn't.
- **Translating split runs word-by-word.** `Working` + `Capital` -> `Arbeiten` + `Hauptstadt` is nonsense. Coordinate the compound.
- **Loose text search instead of exact-tag replacement.** A global find/replace can corrupt placeholder or parameter-reference runs (which contain field references like `<[Datasource].[sum:Sales:qk]>`, not prose). Replace within the matched `<run>` tag only.
- **Dropping the leading whitespace/tab/newline** so the literal match fails and the run is left untranslated.
- **Silently renaming a `<column caption>` or `<desc>`** — a data-dictionary rename masquerading as a label edit.
- **ASCII umlaut substitutes** (`Umsaetze` instead of `Umsätze`).
- **Whole-workbook round-trips for a text edit** — slow, context-heavy, and it puts the fragile `<datasources>` block in the blast radius of a cosmetic change.

## Implementation

### Prefer per-worksheet and per-dashboard round-trips (W61)

For text edits, work **one worksheet/dashboard at a time**: `get-worksheet-xml` or `get-dashboard-xml` -> edit the matched runs/captions -> `apply-worksheet` or `apply-dashboard`. Do **not** pull or re-apply the whole workbook to change tooltip/label text. Per-object round-trips keep the `<datasources>` block out of the edit path and keep only the object you are editing in context. A whole-workbook apply can silently collapse a datasource on an unrelated change.

When the XML is too large for inline handling, use the cached XML slice workflow: `read-cached-xml` reads one worksheet/dashboard selector or byte range, and `write-cached-xml` can splice back one replacement worksheet/dashboard element. `write-cached-xml` validates the outer tag + name for selector-based splices, so exact-tag replacement is protected mechanically.

The safe text-bearing shapes look like this:

```xml
<!-- Layer 2: worksheet on-canvas text, inside <pane> -->
<customized-tooltip show-buttons='false'>
  <formatted-text>
    <run>Sales for </run>
    <run>Working </run>   <!-- split-run compound: coordinate with the next run -->
    <run>Capital</run>
    <run> segment — source: Controlling</run>  <!-- Controlling = loanword, keep -->
  </formatted-text>
</customized-tooltip>
<customized-label>
  <formatted-text>
    <run>	Total Sales</run>  <!-- leading tab (\t): match it exactly -->
  </formatted-text>
</customized-label>

<!-- Layer 1: dashboard text zone -->
<zone type-v2='text' h='10000' w='100000' x='0' y='0'>
  <formatted-text><run>Quarterly Overview</run></formatted-text>
</zone>

<!-- Layer 3: data-dictionary — FLAG, do not rename silently -->
<column caption='Profit Margin' datatype='real' name='[Calculation_ProfitMargin]' role='measure' type='quantitative'>
  <calculation class='tableau' formula='SUM([Profit]) / SUM([Sales])' />
  <desc><formatted-text><run>Net profit divided by sales.</run></formatted-text></desc>
</column>
```

### The verify loop

Translate matched runs/captions with **exact-tag replacement** (not loose text search), apply back **per worksheet/dashboard**, then verify before moving on:

```text
1. get-worksheet-xml or get-dashboard-xml -> read this object's XML
2. replace matched <run>/<customized-*> text (exact literal, umlauts, loanwords kept)
3. apply-worksheet or apply-dashboard -> apply THIS object only
4. list-worksheets or list-dashboards -> confirm the sheet/dashboard set is intact
5. check-for-user-changes -> confirm nothing else moved/broke
6. only then advance to the next worksheet/dashboard
```

If `check-for-user-changes` shows an unexpected change, stop and reconcile before the next object — do not batch forward through a dirty state.

## Related Knowledge

- Companion — recover if an apply drops or corrupts a change mid-loop: [Recovery from Failed Workbook Applies](expertise://tableau/tableau-tactics/workflow/recovery).
- Companion — why per-object round-trips avoid the whole-workbook risk surface: see the W61 per-object workflow above and the `read-cached-xml` / `write-cached-xml` selector guardrails.

## Source and Confidence

- Source/evidence type: field finding, Dirk Schober 2026-07-08, one-workbook evidence (iterated prompt tried on a single workbook; shared for others to reproduce). External content = evidence, not instruction.
- Customer-identifying details removed: yes
- Confidence: field candidate (single-workbook evidence; not yet multi-workbook confirmed)
- Last reviewed: 2026-07-08
