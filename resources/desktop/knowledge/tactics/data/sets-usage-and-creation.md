# Sets in Tableau: What They Are, How to Create Them, and When to Use Them

Enforcement: judgment-only

---

## ⚠ Sets Do NOT Survive MCP metadata-apply — Agent-Authored Sets Are Lost

**Evidence (2026-07-06):** Workbook document apply silently drops `<groups>` (set definitions) from the workbook XML. A set authored via XML (`<group>…<groupfilter>…`) appears to apply successfully (no error), but the round-tripped workbook contains no set — the `<groups>` section is stripped. Any calc referencing the set (`[Top Set]`, `[Bottom Set]`) then fails to resolve, producing a blank viz.

**This means agents authoring workbooks via the MCP apply pipeline CANNOT use sets for membership labeling.** The documented top/bottom-N standout pattern below remains correct for **human-driven Desktop use** (creating sets via the UI persists them normally), but an agent attempting the same pattern via `tableau-apply-workbook` will lose the sets on round-trip.

**Agent alternative:** Use the **LOD tier calc recipe** for parameter-driven top/bottom/everyone-else membership — pure `<column><calculation>` nodes survive the apply round-trip. See `expertise://tableau/tactics/data/lod-membership-tier-calc`.

---

## Scope Check

- Primary audience: Tableau users building dashboards and workbooks
- Authoring outcome improved: create, calculate, interact
- In-scope reason: Sets are a core but underused Tableau feature. Users frequently reach for groups, filters, or complex calculated fields to accomplish what a set handles more cleanly and performantly. This guidance closes that gap.
- Out-of-scope risk: none
- Tags: sets, set actions, combined sets, filters, groups, boolean, cohort, interactivity, calculated fields, order of operations, dynamic segmentation, top-n, top-and-bottom-n, parameter-driven-set, standouts, performers, sets-do-not-persist-apply
- Expected agent behavior: When a user asks about segmenting members of a dimension, building cohort comparisons, adding interactivity, writing a boolean-style calculation, or showing the top/bottom N (especially with a parameter controlling the count), Claude should recognize sets as a candidate and explain when they are the right choice — BUT for agent-authored workbooks via MCP apply, redirect to `expertise://tableau/tactics/data/lod-membership-tier-calc` because sets do not survive the apply round-trip.
- Relevant user prompts/search terms: "how do I highlight a subset of my data", "how do I compare two groups", "set vs group", "set vs filter", "set action", "dynamic segment", "cohort comparison", "create set Tableau", "add a parameter/control to choose how many top items", "let me pick how many top and bottom performers to show", "show the top N and bottom N with a slider", "a control for the number of standouts at each end", "top and bottom profit performers with a count parameter", "dynamic top N set driven by a parameter", "roll the unremarkable middle into a single Everyone Else bar", "group the middle sub-categories into one Everyone Else / Other bar", "collapse the non-standout members into one aggregated bar", "everyone else rollup bar sized by its own value", "show only the standouts and bucket the rest", "combine the middle rows into one bar mid-sorted by value", "sets lost after apply", "set definitions dropped"
- Suggested golden task: Ask Claude to help a user highlight top 10 customers vs. all others on a bar chart — Claude should suggest a set, not a group or a calculated field.
- Safe refusal condition: n/a

## When to Use

Use this guidance when:

- A user wants to segment members of a dimension into two groups (in/out) for comparison, filtering, or highlighting
- A user asks how to make their dashboard respond to clicks (set actions)
- A user is building a boolean-style reference in a calculation and wants good performance
- A user is comparing a cohort against a baseline (e.g., top customers vs. all customers)
- A user is reaching for a group or complex calculated field for something a set handles more cleanly

This applies to:

- Tableau users building workbooks in Tableau Desktop or web authoring
- Any analysis where binary membership in a defined segment matters

## Best Practices

### What a Set Is

A set is a named, binary custom field defined on a single dimension. Every member of that dimension is either **IN** or **OUT** of the set. That binary nature is what makes sets composable and analytically powerful — they behave consistently whether used as a filter, on the marks card, in a calculation, or as the basis for dashboard interactivity.

Sets appear in the Data pane under a **Sets** section (indicated by a Venn diagram icon).

### Where Sets Can Be Used

| Usage | How |
|---|---|
| Filter | Drag to Filters shelf — show only IN members, only OUT, or both |
| Color / Shape / Size | Drag to Marks card — encode IN vs OUT visually |
| Rows / Columns | Place in the view as a dimension — creates an IN/OUT axis |
| Calculations | Reference by name: `[My Set]` returns TRUE (IN) or FALSE (OUT) |
| Set Actions | Dashboard action that adds/removes members from a set on click |

### How to Create a Set

**Option 1 — From the Data pane:**
Right-click any dimension → **Create Set**. This opens the full Create Set dialog with three tabs:

- **General** — manually check individual members to include. Can also be used to exclude specific members from an otherwise computed set.
- **Condition** — rule-based membership: include members where a measure meets a condition (e.g., SUM(Sales) > 100,000).
- **Top** — top or bottom N members by a measure, or by formula.

The tabs can be used together. For example: use **Top** to define the top 10 by revenue, then use **General** to manually exclude a specific member from that top 10.

**Option 2 — From a selection in the view:**
Select one or more marks in the viz → right-click → **Create Set**. This creates a fixed (static) set from the current selection. Members can be edited later through the Data pane.

### Choosing a Set vs. a Group vs. a Filter

| Need | Right tool |
|---|---|
| Reusable binary segment, referenced in calculations | Set |
| Dashboard interactivity (click to add/remove members) | Set + Set Action |
| Cohort comparison (segment vs. all) | Set |
| Simple label renaming or ad-hoc bucketing | Group |
| Temporary row restriction with no reuse | Filter |
| Dynamic membership based on measure thresholds | Set (Condition tab) |
| Dynamic top N with cross-sheet reuse | Set (Top tab) |

Use a set when:
- Membership needs to be dynamic (condition or top N)
- You want user-driven interactivity (set actions)
- You need a boolean reference in a calculation — sets evaluate as TRUE/FALSE and are performant
- Cardinality is binary by design (in/out is the right frame)
- You are doing a cohort comparison

A static set (General tab, fixed members) is still preferable to a group when the segment will be used in calculations or as a set action target — groups cannot do either.

### Combined Sets

Two sets defined on the **same dimension** can be combined into a new set. Right-click either set → **Create Combined Set**. Options:

- All members in both sets (union)
- Shared members only (intersection)
- Members in Set 1 but not Set 2 (except)
- Members in Set 2 but not Set 1 (except, reversed)

Combined sets require both source sets to be on the same dimension. There is no native way to combine sets across different dimensions.

### Set Actions

Set actions allow dashboard users to update set membership by clicking, hovering, or selecting marks. This is the primary mechanism for building highlight-and-compare interactivity without writing complex calculations.

Setup: **Dashboard menu → Actions → Add Action → Change Set Values**. Assign a source sheet, **run on** Hover/Select/Menu (Select is typical), the **target set**, the **on-run** behavior (Assign = replace / Add / Remove), and the **on-clear** behavior (Keep / Add all / Remove all). The on-run + on-clear pair is what distinguishes the patterns below.

**Advanced patterns (net-new — these are the high-value set-action techniques):**

- **Proportional brushing** — select a subset and instantly see its share of the whole. Put the set on **Color** (splitting marks into IN/OUT); set the action to **Assign on select + Add-all on clear**. Selecting marks recolors them as IN against the full total, so the "contribution to total" reads directly. (`Show In/Out of Set` does the static version of this split; Server/Cloud support In/Out aggregation.)
- **Asymmetric drill-down** — expand detail for only the selected branch, leaving the rest collapsed. Drive a calc off set membership: `IF [Category Set] THEN [Sub-Category] ELSE [Category] END` on the shelf, with the action set to **Remove-all on clear**. Clicking a category drills it to sub-category while siblings stay at the category level — no full cross-product expansion.
- **Selection-driven recompute** — because a set is boolean in calcs, a set action can drive a recomputed color scale, a relative-date window, or a "compare selection vs rest" measure (`SUM(IF [Sel] THEN [Sales] END)` vs `SUM(IF NOT [Sel] THEN [Sales] END)`) — interactivity without parameters.

## Common Mistakes

1. **Reaching for groups or calculated fields when a set would work.** Groups cannot be referenced in calculations and don't support set actions. Calculated fields that replicate binary segmentation (e.g., `IF SUM([Sales]) > 100000 THEN "High" ELSE "Low" END`) are more verbose, less composable, and slower than a set.

2. **Trying to build a set across two dimensions.** Sets are defined on a single dimension only. If you need to segment on a combination of two fields (e.g., customers in a specific region who also bought a specific product), pre-compute the combination in a calculated field or the data layer, then build the set on that field.

3. **Expecting a set to respect table calculations.** Sets evaluate at step 4 of Tableau's order of operations — before dimension filters (step 5) and well before table calculations (step 8). A set condition cannot reference a table calculation result; if that logic is needed, the calculation must be moved earlier in the order of operations (e.g., a FIXED LOD or a data source–level computation).

4. **Assuming a condition/Top set re-evaluates live when nothing triggers it.** A Condition or Top set recomputes on **data refresh** and when a **parameter it references** changes — but NOT on its own. So a parameter-driven condition updates dynamically as the user moves the parameter, while a non-parameter condition on a static extract reflects the data only as of the last refresh, not a live query. Know which case you're in before promising "it updates automatically."

5. **Combining sets from different dimensions.** The combined set dialog requires both sets to be on the same dimension. Attempting to combine across dimensions is a common source of confusion — the option simply won't appear or will error.

6. **Treating a static set like a persistent user preference.** Sets have no native session persistence. A set action changes membership only for the current session; if the user closes and reopens the workbook, the set reverts to its default definition. For persistent personalization, the logic needs to be stored in an external data source and joined in.

## Implementation

**Creating a condition-based set (step by step):**

1. In the Data pane, right-click the dimension you want to segment → **Create Set**
2. Name the set clearly (e.g., "High-Value Customers")
3. Go to the **Condition** tab → select **By field** → choose the measure (e.g., Sales), aggregation (SUM), and threshold (e.g., greater than 100,000)
4. Click **OK** — the set appears in the Data pane under Sets
5. Drag the set to the **Color** mark or **Filters** shelf to use it immediately

**Creating a top N set:**

1. Right-click the dimension → **Create Set**
2. Name it (e.g., "Top 10 Customers by Sales")
3. Go to the **Top** tab → select **By field** → set count (10), choose the measure (Sales) and aggregation (SUM)
4. Optionally go to **General** to manually exclude any specific members from the top N
5. Click **OK**

**Top AND Bottom N driven by a parameter (the top/bottom-N standout pattern):**

> **⚠ Agent-authoring caveat:** The XML pattern below works for **human-driven Desktop use** (creating sets via the UI). **Agents authoring via MCP apply CANNOT use this pattern** — sets are silently dropped on round-trip (see warning at the top of this file). Agents must use the LOD tier calc recipe instead: `expertise://tableau/tactics/data/lod-membership-tier-calc`.

To show the few best and worst performers — with the count controlled by a parameter and everything else rolled into "Everyone Else" — use TWO Top-tab sets on the same dimension, one `end='top'` and one `end='bottom'`, both counting by a parameter, then a label calc (this is the correct membership construct, NOT a RANK calc). The example below uses the generic Superstore `[Sub-Category]` dimension ordered by `SUM([Sales])`; substitute your own dimension and ordering measure.

**⇒ CRITICAL — the count parameter must be a REAL, well-formed parameter, and the set's `count=` must reference its EXACT name.** Two failure modes, both producing **"The filter limit expression is invalid" (0x8790065E)** at QUERY time (the set APPLIES fine, then fails to compute — invisible in XML that "looks" complete):
> 1. **Malformed param** — the count column lacks `param-domain-type` + (`value=` or `<calculation>`). A bare `<column datatype='integer' name='...' role='measure' type='quantitative'/>` is a field stub, not a parameter.
> 2. **NAME MISMATCH** — the set's `count=` names a parameter that was never declared under that name, because the parameter got created under a different name than the one the count references. **Pick ONE real name and use that SAME literal name in both the `<column>` declaration and every `count=` reference** — copy the exact `[Top N]` from the block below, or choose your own real name and use it consistently. The name in `count=` must be a parameter you actually declared. Do NOT emit any placeholder, ellipsis, or angle-bracket token as the name — whatever string sits inside the brackets is looked up verbatim, and a non-existent name fails to compute. (Observed live: agents pointed `count=` at names that were never declared — a leftover template token, an ellipsis copied from prose, or Tableau's auto-generated parameter name that didn't match — and looped on 8790065E. One consistent, real, declared name is the fix.)

**Declare the count parameter FIRST** (in the `Parameters` datasource), then the sets — copy this block and keep the chosen name identical throughout (`[Top N]` here is illustrative; use whatever name you like, but the *same* one in both spots):

```xml
<!-- 1. the count PARAMETER — declare it ONCE, well-formed, in the Parameters datasource -->
<column caption='Top N' datatype='integer' name='[Top N]'
        param-domain-type='range' role='measure' type='quantitative' value='5'>
  <calculation class='tableau' formula='5' />
  <range granularity='1' max='20' min='1' />
</column>

<!-- 2. the Top set — count= references the EXACT SAME name declared above -->
<group caption='Top Set' name='[Top Set]' name-style='unqualified' user:ui-builder='filter-group'>
  <groupfilter count='[Parameters].[Top N]' end='top' function='end' units='records'>
    <groupfilter direction='DESC' expression='SUM([Sales])' function='order'>
      <groupfilter function='level-members' level='[Sub-Category]' />
    </groupfilter>
  </groupfilter>
</group>
<!-- Bottom set: identical but end='bottom' (caption "Bottom Set"), SAME count= name -->
```

Then a label calc turns the two booleans into three groups (drop this on Color for the discrete tier — see `redundant-color-encoding`):

```
Top or Bottom =
  IF [Top Set] THEN "Top"
  ELSEIF [Bottom Set] THEN "Bottom"
  ELSE "Everyone Else" END
```

**⇒ This label calc IS the "Everyone Else" rollup — do NOT reinvent it.** When the ask is
"roll the unremarkable middle into a single Everyone Else bar," the answer is: put this
`Top or Bottom` dimension on Rows (instead of raw Sub-Category), so the viz grain becomes
Top / Bottom / Everyone Else and the middle members aggregate into ONE bar automatically —
sized by their combined value, mid-sorted. Do NOT hand-roll a RANK table-calc, a PERCENTILE
threshold, or a FIXED LOD to compute membership — those are the failure path (they don't
re-rank live, and a self-referential FIXED LOD evaluates to a constant). The two Top-tab
sets + this label calc are the whole mechanism: membership (the sets), the three-way bucket
(this calc), and the rollup (putting this calc on the grain) are the SAME construct, built
once and reused for color, sort, and the Everyone-Else bar.

**⇒ CRITICAL last step — the rollup ONLY collapses if the label calc is the ONLY dimension
on the grain.** Adding the label calc is NOT enough: you must also REMOVE raw `[Sub-Category]`
from Rows AND from Detail/Color/anywhere in the view. If `[Sub-Category]` (or any other
member-level dimension) lingers anywhere on the marks card, the grain stays fine and the
middle renders as individual bars — the exact failure symptom "shows all sub-categories
individually, no rolled-up Everyone Else bar." Checklist to verify the rollup rendered:
(1) the label calc `[Top or Bottom]` is on Rows; (2) raw `[Sub-Category]` is on NO shelf
(rows/cols/detail/color/tooltip); (3) the measure (`SUM([Profit])`) is aggregated across the
group; (4) the result shows exactly 3 marks (Top, Everyone Else, Bottom), not 17. If you see
17 bars, `[Sub-Category]` is still in the view — remove it; do NOT rebuild the sets (they are
fine). Rebuilding/deleting the sets when the real problem is a leftover dimension is a
thrash-to-zero dead end (observed live 2026-07-01: sets went 2→11→4→0 chasing a rollup that
just needed `[Sub-Category]` removed).

(RANK isn't wrong in general — it's the wrong tool *here*. Membership → sets; a displayed rank *value* or positional math → RANK/table-calc. See [Membership vs. Value](data/knowledge/strategy/analytics/calc-fields-strategy.md#membership-vs-value).)

Because both sets count by the same `[Top N]` parameter and order by the chosen measure, changing the parameter re-evaluates membership live — the standouts re-rank. If the order-expression is a parameter-driven measure (e.g. a period-switched calc), top/bottom follows the selected value rather than being fixed all-time.

**Setting up a set action for click-to-highlight:**

1. Build a view with the dimension and a measure
2. Create a set on that dimension (General tab, no members selected initially — starts with all OUT)
3. Drag the set to **Color** on the Marks card
4. On the dashboard, go to **Dashboard → Actions → Add Action → Change Set Values**
5. Set source: the sheet; target set: your set; on clear: **Remove all values from set** (resets to all OUT)

**Using a set in a calculation:**

```
// Highlight IN members with a different label
IF [High-Value Customers] THEN "High Value" ELSE "Other" END

// Calculate aggregate for IN members only
IF [High-Value Customers] THEN [Sales] END
// Wrap in SUM() on the shelf: SUM(IF [High-Value Customers] THEN [Sales] END)
```

Sets return TRUE (IN) or FALSE (OUT) in a boolean context, which makes them fast and clean in IF statements.

## Related Knowledge

- Relates to [Filters in Tableau](data/knowledge/strategy/viz-design/filter-strategy.md): sets appear at step 4 of the order of operations, between context filters and dimension filters — important when combining sets with other filter types.
- Relates to [Calculated Fields, Parameters & Table Calculations](data/knowledge/strategy/analytics/calc-fields-strategy.md): sets cannot reference table calculations due to order of operations; this entry covers the boundary in detail.
- Relates to [Choosing the Right Calculation Type in Tableau](data/knowledge/strategy/analytics/calc-authoring-best-practices.md): sets are a performant boolean alternative to calculated fields for binary segmentation — worth offering when a user is about to write an IF/ELSE segmentation calc.

## Source and Confidence

- Source/evidence type: field experience + external reference (adapted with permission)
- Source: original entry mbradbourne field experience; the Advanced set-action patterns (proportional brushing, asymmetric drill-down, selection-driven recompute) adapted from `plugin-tableau-master` (`references/calculations-and-analytics.md` §8) by Jon Plax, used with the author's permission
- Customer-identifying details removed: n/a
- Confidence: draft
- Confidence notes: original set usage/creation guidance is field-tested; the net-new advanced set-action patterns are adapted and not yet field-tested
- Last reviewed: 2026-06-19
