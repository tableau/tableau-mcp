# Calc Evaluation: NULL Propagation & the ELSE-Catches-Null Trap

How Tableau's calculation language evaluates NULL through comparisons and `IF/ELSEIF/ELSE` chains. This is a correctness gotcha, not a syntax rule: a formula that looks right produces a silently wrong bucket when its input can be NULL.


**Tactics companion:** `expertise://tableau/tactics/data/calc-fields` — calc-field XML/authoring mechanics. This module is the evaluation-semantics layer for the formulas authored there.

## Scope Check

- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: create, troubleshoot
- In-scope reason: Prevents silent misbucketing when calculated fields process NULL inputs through IF/ELSE chains, ensuring correct tier assignments.
- Out-of-scope risk: none
- Tags: null, isnull, ifnull, zn, else, if, elseif, comparison, evaluation-semantics, silent-misbucket, coalesce
- Relevant user prompts/search terms: "extra null bucket on my chart", "extra null category appeared on my chart", "null category from a calculation", "where did the null category come from", "IF ELSE puts nulls in the wrong bucket", "nulls counted as Saturday", "comparison with null", "why does my ELSE bucket have too many rows", "guard against null in a calc", "calculation created an unexpected null group"

## When to Use

Read this when authoring or reviewing any `IF/ELSEIF/ELSE` (or nested `IF`) calculation whose input field can be NULL — especially:

- A tiering/bucketing calc over a measure that can be null (e.g. a lifetime-revenue tier).
- A categorization built on a **date derivation** (`MONTH()`, `WEEKDAY()`, `YEAR()`) where the source date can be null.
- Any calc that reads a field which may be null because of an outer/orphan join or a missing lookup.
- Diagnosing a chart that shows an **extra NULL bucket**, or a final/ELSE category that has **more rows than expected**.

## The core behavior

Tableau three-valued logic: a comparison against NULL evaluates to **NULL**, and NULL is treated as **not true** by `IF`. So in a chain, a NULL input fails *every* `THEN` test and **falls through to the `ELSE` arm**.

```
IF      [Lifetime Revenue] >= 5000 THEN "Platinum"
ELSEIF  [Lifetime Revenue] >= 2000 THEN "Gold"
ELSEIF  [Lifetime Revenue] >= 500  THEN "Silver"
ELSE    "Bronze"
END
```

If `[Lifetime Revenue]` is NULL: `NULL >= 5000` is NULL (not true), every `ELSEIF` likewise fails, and the row lands in **"Bronze"** — not in a separate null bucket. The chart shows a skewed "Bronze" total with no indication anything is wrong.

### The silent-misbucket case (worse)

When the final `ELSE` returns a **literal** rather than the result of a comparison, NULL rows are misbucketed into that literal with zero error signal:

```
IF      WEEKDAY([Ship Date]) = 1 THEN "1 Sunday"
ELSEIF  WEEKDAY([Ship Date]) = 6 THEN "6 Friday"
ELSE    "7 Saturday"          // ← every NULL Ship Date piles in here
END
```

`WEEKDAY(NULL)` is NULL; `NULL = 1` is NULL; all tests fail; null-dated rows render as "Saturday" alongside genuine Saturdays. (Observed: 53 null-`Ship Date` rows all rendered "7 Saturday" until a guard was added.)

## Best Practices

- **Add an explicit outer null guard** so NULL inputs return NULL instead of falling through:
  `IF ISNULL([Ship Date]) THEN NULL ELSE <the IF/ELSEIF chain> END`. The null rows then form an honest NULL bucket (or are excluded) rather than contaminating a real category.
- **Or coalesce the input to a sentinel** that lands NULLs in the bucket you actually intend, before the comparison chain: `ZN([Lifetime Revenue])` (→ 0) or `IFNULL([x], -1)` with a sentinel below all thresholds so nulls fall into the intended low tier deliberately, not accidentally.
- **Decide where nulls belong, explicitly.** The bug is not "nulls exist" — it is nulls landing somewhere *by accident*. Choose: own NULL bucket, excluded, or a named tier — and encode that choice.
- **Apply the guard to every nested-IF categorization over a nullable source** — date-derived dimensions (`WEEKDAY`/`MONTH`/`YEAR`), lookup/blend-derived fields, and anything that can carry NULL from an outer join.

## Common Mistakes

1. **Assuming a NULL input produces a NULL/own bucket.** It does not — it silently takes the `ELSE` arm. This is the #1 cause of an unexpected count in the last category of a tiering calc.
2. **Trusting that "no error" means "correct buckets."** The misbucket is silent: the calc compiles, the view renders, totals are just quietly wrong.
3. **Guarding only the first branch.** `IF ISNULL([x]) THEN ... ` must wrap the *entire* chain; a guard on one `ELSEIF` still lets other NULL paths fall through.
4. **Using a coalesce sentinel that collides with real data.** `IFNULL([x], 0)` is wrong if `0` is a meaningful value for `[x]`; pick a sentinel outside the real domain.

## Implementation

1. Identify whether the calc's source field can be NULL (nullable measure, date that can be missing, outer/blend/lookup field).
2. If it can, wrap the whole conditional: `IF ISNULL([source]) THEN NULL ELSE <chain> END`, **or** coalesce the source to a deliberately-chosen sentinel before the comparisons.
3. Verify by checking the category counts/totals against the raw row count for NULL-source rows — confirm they land where you intended, not in the trailing `ELSE`.
4. For the calc-field XML and naming rules, see `expertise://tableau/tactics/data/calc-fields`.

## Source and Confidence

- Source/evidence type: field-tested
- Source: Confirmed behavioral observation — null Ship Date rows misbucketed until an outer NULL guard was added
- Customer-identifying details removed: yes
- Confidence: field-tested
- Last reviewed: 2026-07-03
