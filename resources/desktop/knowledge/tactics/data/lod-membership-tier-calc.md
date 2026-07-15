# LOD Membership Tier Calc: Persistable Top/Bottom/Everyone-Else

The **agent-safe** recipe for parameter-driven membership labeling. Unlike sets (which are silently dropped by `load-underlying-metadata`), this construct uses only `<column><calculation>` nodes that survive the MCP apply round-trip.

---

## Scope Check

- Primary audience: Tableau agent / SE authoring XML via MCP apply
- Authoring outcome improved: create, calculate
- In-scope reason: Provides the persistable calc-column alternative to sets for top/bottom/everyone-else membership labeling in agent-authored workbooks — the only working path for this common Workout Wednesday pattern.
- Out-of-scope risk: none
- Tags: lod, fixed, membership, tier, top-n, bottom-n, everyone-else, percentile, threshold, standouts, performers, rollup, apply-safe, sets-alternative
- Expected agent behavior: When tasked with top/bottom/everyone-else membership labeling (common in WW challenges), use this recipe instead of sets. The validation rule `rank-as-membership` now points here.
- Relevant user prompts/search terms: "top performers bottom performers everyone else", "membership tier calc", "LOD tier label", "top N bottom N with everyone else", "standouts and bucket the rest", "collapse middle into everyone else bar", "parameter-driven top bottom tier", "color by top bottom group", "roll up the middle", "discrete tier color", "sets do not persist", "sets lost after apply", "groups dropped on apply", "alternative to sets for agent", "membership calc that survives apply"

---

## When to Use

Use this recipe when:

1. **Agent authoring via MCP apply** — sets do NOT survive the apply round-trip (confirmed 2026-07-06); this is the only working membership construct for that path.
2. **Parameter-driven top/bottom/everyone-else bucketing** — show the best and worst performers with the count controlled by a parameter, and roll the middle into "Everyone Else."
3. **Row-level discrete tier** — you need a dimension that partitions Rows, is colorable as discrete, and can be a set-action target equivalent.

**Do NOT use** for:
- Human-driven Desktop use where sets work fine — sets have better parameter-binding semantics (`count='[Parameters].[N]'` re-ranks live; LOD calcs require a separate threshold calc per percentile boundary).
- Exact top-N counts when ties at the boundary matter — the percentile approach puts tied values in the same bucket (often the correct behavior for analytics), but if you need exact row counts matching SQL `NTILE(k)`, this is an approximation.

---

## Best Practices

### The three-calc pattern (percentile thresholds)

For Superstore-style "Top/Bottom/Everyone-Else Sub-Categories by Profit":

**1. Per-member value calc** — collapse each dimension member to a single row-level value:
```
[Member Profit] = { FIXED [Sub-Category] : SUM([Profit]) }
```

**2. Global percentile thresholds** — distribution stats on the per-member values:
```
[Top Threshold]    = { FIXED : PERCENTILE([Member Profit], 0.80) }
[Bottom Threshold] = { FIXED : PERCENTILE([Member Profit], 0.20) }
```

**3. Tier label calc** — discrete dimension for membership:
```
[Profit Tier] =
  IF [Member Profit] >= [Top Threshold] THEN "Top"
  ELSEIF [Member Profit] <= [Bottom Threshold] THEN "Bottom"
  ELSE "Everyone Else"
  END
```

**Why it round-trips:** Every calc is an ordinary `<column><calculation>` node — the structure that the example corpus confirms survives apply (see `twb-example-index.json` entries with `formula=\"{fixed`). No `<groups>` section involved.

**Why the nested FIXED matters:** The inner `{ FIXED [Sub-Category] : … }` collapses each sub-category to one row before percentile is taken. Without it, sub-categories with many transactions over-weight the distribution.

### Parameter-driven threshold variant

To let the user control the tier cutoffs via parameters (like the sets pattern's `count=` param):

**Declare parameters:**
```
[Top Pct]    = 0.80   (range 0.5–0.99, step 0.05)
[Bottom Pct] = 0.20   (range 0.01–0.5, step 0.05)
```

**Threshold calcs reference params:**
```
[Top Threshold]    = { FIXED : PERCENTILE([Member Profit], [Parameters].[Top Pct]) }
[Bottom Threshold] = { FIXED : PERCENTILE([Member Profit], [Parameters].[Bottom Pct]) }
```

Moving the parameter re-evaluates the percentile cutoffs → membership re-ranks live.

### Shelf placement for the "Everyone Else" rollup

The Workout-Wednesday shape keeps INDIVIDUAL bars for the standouts and collapses only the middle. Add a row-level grouped-label calc:

```
[Member (Grouped)] = IF [Profit Tier] = "Everyone Else" THEN "Everyone Else" ELSE [Sub-Category] END
```

1. Put `[Member (Grouped)]` on **Rows** — top/bottom members keep their names; the middle collapses into one "Everyone Else" row
2. `SUM([Profit])` on Cols; `[Profit Tier]` on Color

**THE SUM-ROLLUP DISTORTION (live-proven 2026-07-07 — eval judges flag this):** the rolled-up bar is then the SUM of all middle members (~$173K in Superstore), which DWARFS the real top performer (Copiers ~$56K) and, profit-sorted, lands at the TOP — misrepresenting the middle as the best performer. Keep the middle bar modest — size it by the per-member average and say so in the tooltip:

```
[Display Profit] = IF MIN([Profit Tier]) = "Everyone Else"
                   THEN SUM([Profit]) / COUNTD(IF [Profit Tier] = "Everyone Else" THEN [Sub-Category] END)
                   ELSE SUM([Profit]) END
```

(The condition must be aggregated — `MIN([Profit Tier])` — because the branches are aggregates; a bare `IF [Profit Tier] = …` mixes row-level and aggregate and Tableau rejects the calc. At the grouped-label grain every row in a partition shares one tier, so MIN is exact, not a heuristic.)

The published W44 keeps Everyone Else as a small grey bar nestled mid-ranking; an aggregate bar that outranks every performer is structurally tier-correct but analytically wrong.

**Simple 3-bar variant** (Top | Everyone Else | Bottom): put `[Profit Tier]` alone on Rows and remove `[Sub-Category]` from all shelves — the same middle-bar distortion warning applies.

### Discrete-tier color

Put `[Profit Tier]` on **Color** as a discrete dimension. Assign a palette:
- Top → green
- Everyone Else → gray
- Bottom → red

This is the "discrete groups vs gradient" encoding from `marks-and-encodings` — color by "which group", not the raw measure.

---

## Common Mistakes

1. **Using a table calc (RANK/INDEX) for membership** — table calcs evaluate at Order-of-Operations step 8, after the grouping is needed. The `rank-as-membership` validation rule blocks this pattern and points here.

2. **Using sets for agent-authored workbooks** — sets are silently dropped by `load-underlying-metadata` (both modes). The workbook applies, but the sets are gone on round-trip. Use this LOD pattern instead.

3. **Skipping the inner FIXED** — writing `{ FIXED : PERCENTILE(SUM([Profit]), 0.8) }` without collapsing to member grain first. High-transaction members over-weight the distribution.

4. **Leaving the raw dimension on Detail** — if `[Sub-Category]` is anywhere in the view, the grain stays fine-grained and the rollup doesn't collapse. Remove it to get 3 marks.

5. **Hardcoding thresholds** — writing `IF [Member Profit] > 5000 THEN "Top"` instead of using percentile calcs. The data changes; hardcoded thresholds don't adapt.

6. **Expecting exact top-N counts** — the percentile approach assigns equal-value members to the same bucket. This is usually the right behavior (identical performers get identical treatment), but differs from SQL `NTILE(k)` which forces exact row counts. For most WW-style standout labeling, percentile semantics are correct.

---

## Implementation

### XML structure for the three calcs

All three are datasource-level `<column>` nodes (or `datasource-dependencies` inline calcs). Example using timestamped names:

```xml
<!-- 1. Per-member value -->
<column caption="Member Profit" datatype="real" name="[Calculation_20260706_001]"
        role="measure" type="quantitative">
  <calculation class="tableau" formula="{ FIXED [Sub-Category] : SUM([Profit]) }"/>
</column>

<!-- 2. Top threshold (80th percentile) -->
<column caption="Top Threshold" datatype="real" name="[Calculation_20260706_002]"
        role="measure" type="quantitative">
  <calculation class="tableau" formula="{ FIXED : PERCENTILE([Calculation_20260706_001], 0.80) }"/>
</column>

<!-- 3. Bottom threshold (20th percentile) -->
<column caption="Bottom Threshold" datatype="real" name="[Calculation_20260706_003]"
        role="measure" type="quantitative">
  <calculation class="tableau" formula="{ FIXED : PERCENTILE([Calculation_20260706_001], 0.20) }"/>
</column>

<!-- 4. Tier label calc (discrete dimension) -->
<column caption="Profit Tier" datatype="string" name="[Calculation_20260706_004]"
        role="dimension" type="nominal">
  <calculation class="tableau"
    formula="IF [Calculation_20260706_001] &gt;= [Calculation_20260706_002] THEN 'Top'&#10;ELSEIF [Calculation_20260706_001] &lt;= [Calculation_20260706_003] THEN 'Bottom'&#10;ELSE 'Everyone Else'&#10;END"/>
</column>
```

**Column-instance for tier calc** (discrete dimension, `none:` derivation):
```xml
<column-instance name="[none:Calculation_20260706_004:nk]"
                 column="[Calculation_20260706_004]"
                 derivation="None" pivot="key" type="nominal"/>
```

### Worked WW44-shaped example

The classic "top/bottom profit performers with a slider" ask:

1. **Parameter:** `[Top N Pct]` = 0.20 (top 20% = ~3 of 17 sub-cats)
2. **Member Profit:** `{ FIXED [Sub-Category] : SUM([Profit]) }`
3. **Top Threshold:** `{ FIXED : PERCENTILE([Member Profit], 1 - [Parameters].[Top N Pct]) }`
4. **Bottom Threshold:** `{ FIXED : PERCENTILE([Member Profit], [Parameters].[Top N Pct]) }`
5. **Tier Label:** IF/ELSEIF/ELSE as above
6. **Member (Grouped):** `IF [Tier Label] = "Everyone Else" THEN "Everyone Else" ELSE [Sub-Category] END`
7. **Rows:** `[Member (Grouped)]` — standouts stay individual, middle collapses
8. **Cols:** `SUM([Profit])` (or `[Display Profit]` per the distortion guidance above)
9. **Color:** `[Tier Label]`

Result: per-member bars for top and bottom performers (green/red), one modest gray "Everyone Else" bar, profit-sorted. Moving the parameter re-buckets the standouts.

---

## Related Knowledge

- **Why not sets?** — `expertise://tableau/tactics/data/sets-usage-and-creation` documents that sets do not survive MCP apply; this entry is the workaround.
- **Why not RANK table calcs?** — the `rank-as-membership` validation rule explains the Order-of-Operations dead-end.
- **Percentile-cutoff pattern origin** — `expertise://tableau/tactics/data/calc-fields` § "LOD-legal aggregates" documents `PERCENTILE` inside LODs (since 2020.2).
- **Discrete-tier color** — `expertise://tableau/tactics/viz/marks-and-encodings` § "Discrete-tier color" covers the encoding guidance.

---

## Source and Confidence

- Source/evidence type: field-tested (2026-07-06 via MCP apply round-trip verification)
- Source: Derived from calc-fields PERCENTILE LOD pattern + observed sets-apply failure
- Customer-identifying details removed: n/a
- Confidence: draft
- Last reviewed: 2026-07-06
