# Field Hygiene: Naming & Type/Role Correctness

Heuristics for spotting field-level data-model problems by inspecting the data pane — poor names, and fields whose *stored type or role* contradicts what their *name* says they are. These are portable modeling-hygiene signals (true of any BI tool's field list), used to flag issues before you build on a shaky field, or to advise a customer cleaning up a data source.

Tags: field-naming, data-hygiene, type-mismatch, role-mismatch, schema-quality, data-modeling

**Related strategy:** `expertise://tableau/strategy/data-modeling/datasource-strategy` (the connection/relationship decisions that surround this) and `expertise://tableau/strategy/analytics/field-types-reference` (what roles/types *are*). The publish-time consistency gate is `expertise://tableau/strategy/dashboard-design/dashboard-peer-review-checklist` (Data Pane Hygiene section) — this file is the *detection heuristics*; that file is the *review gate*.

## Scope Check

- Primary audience: Tableau user / SE assisting a Tableau user
- Authoring outcome improved: validate, refine, troubleshoot
- In-scope reason: When the agent inspects a data source's fields (before authoring, or when a customer asks "is this data source clean?"), these heuristics let it flag mis-typed, mis-roled, or badly-named fields that will otherwise produce wrong aggregations, broken date logic, or an unmaintainable data pane.
- Out-of-scope risk: none
- Tags: field-naming, data-hygiene, type-mismatch, role-mismatch, schema-quality, data-modeling, snake-case, id-as-measure, date-as-string, systemic-finding, naming-convention
- Relevant user prompts/search terms: "is this data source clean", "why is my date sorting wrong", "my sum is counting IDs", "field names are messy", "clean up my data pane", "date field stored as string", "field naming conventions Tableau", "why is my count field a string", "ID field showing as measure", "field hygiene check", "audit my data source fields"

## When to Use

Use this when:
- **Inspecting a data source before authoring** — catch a date-stored-as-string or an ID-as-measure *before* you build a broken time series or an inflated total on it.
- **A customer asks "is this data source clean?"** or wants a hygiene pass over their fields.
- **A total or a sort looks wrong** and the cause may be a mis-typed field rather than the calc.
- **Advising on naming standards** for a shared/published data source that many workbooks will consume.

This is a *modeling-hygiene* lens, not a publish gate. The peer-review checklist enforces that field names are *consistent across dashboards* at publish time; this file is about detecting the *intrinsic* problems (wrong type, cryptic name) in the first place.

---

## Type & Role Mismatches (highest impact)

A field whose stored type or role contradicts its name is the most damaging class — it silently produces wrong results, not just an ugly pane. Infer intent from the name, compare to the stored type/role:

| Signal | Name pattern (word-boundary match) | Stored as | Severity | Why it matters |
|---|---|---|---|---|
| **Date as string** | `date`, `time`, `created`, `updated`, `timestamp` | `string` | **High** | No date math, no relative-date filters, sorts lexically ("Apr" before "Jan"). Parsing was skipped at connect. |
| **Number as string** | `count`, `amount`, `qty`, `price`, `total`, `rate`, `pct`, `percent`, `revenue`, `cost` | `string` | **High** | Can't aggregate or put on a continuous axis without a cast; SUM/AVG unavailable. |
| **ID as measure** | `id`, `key`, `code`, `number`/`nbr` | role = **measure** | **Medium** | Tableau will `SUM` it by default — summing customer IDs is meaningless and can silently appear in totals. IDs should be dimensions. |
| **Boolean as string** | `is_`, `has_`, `flag`, `active`, `enabled` | `string` | **Low** | `"True"`/`"true"`/`"Y"` won't behave as a boolean; filters and IF tests get brittle. |
| **Role/category mismatch** | — | role = dimension but data is quantitative, or vice-versa | **Low** | Wrong default shelf behavior (headers vs axis). |

**False-positive guards (apply before flagging):**
- **Match on word boundaries**, not substrings — `"considered"` must not trip the `id` check; `"update_status"` (a string status) is not a date.
- **Check for an intentional cast.** A *calculated* field named `date_str` whose formula is `STR([Order Date])` is deliberately a string — inspect the formula; if it shows an intentional conversion, drop the severity or skip.
- **Parameters are exempt** — they're typed by design, not by the source.

---

## Naming Violations

Portable naming smells, by severity. These hurt readability and maintainability rather than correctness:

| Signal | Pattern | Severity |
|---|---|---|
| **System API suffix, un-aliased** | ends in `__c` / `__r` (Salesforce), or similar source-generated tails | Medium |
| **Cryptic abbreviation** | < 4 chars and not a common exception (`id`, `qty`, `amt`, `pct`, `yr`) | Medium |
| **Generic placeholder name** | `value`, `field`, `col`, `data`, `info`, `item`, optionally with a trailing digit | Medium |
| **Raw snake_case, not cleaned** | `three_or_more_words` left as-is | Low |
| **camelCase / no spaces** | `customerName` | Low |
| **SCREAMING_CASE** | `TOTAL_REVENUE` | Low |
| **Table-qualified noise** | field name repeats its logical-table caption | Low |

The goal is human-readable, business-facing names: `Loan Number`, not `loan_nbr` / `LN_NUM` / `__c`. For a *shared* data source, the same field must carry the same name everywhere it's consumed (that consistency rule is enforced at the review gate).

---

## Report Systemically, Not Field-by-Field

A raw list of 60 fields each flagged individually is noise. Aggregate:

- **When more than ~10 fields match the same pattern**, report it as **one systemic finding** with the top 3–5 examples, not 10+ separate items. E.g. *"32 fields are raw snake_case (`order_date`, `customer_region`, `ship_mode`, …) — the source was connected without cleaning field names."*
- **Escalate severity one level when >50% of fields share the defect** — a source where most fields are un-cast strings is a connection-time problem (wrong parse), not a per-field nit.
- **Reduce severity for auto-generated fields** (bins, groups, calculated placeholders) and for sandbox/scratch data sources.

---

## Implementation

1. **List the fields** with their role, data type, and (for calcs) formula — via the data pane or a metadata read.
2. **Run the type/role pass first** — it's the correctness-affecting one. For each field, infer intent from the name and compare to the stored type/role; apply the false-positive guards (word boundaries, intentional-cast check, parameter exemption).
3. **Run the naming pass** — flag the smells above, but only after confirming there's no alias already fixing the display name.
4. **Aggregate to systemic findings** — collapse >10 same-pattern hits into one, escalate if >50% affected.
5. **Report by impact:** high-severity type mismatches first (they produce wrong numbers), then naming (readability). For each, give the fix: *change data type / change to dimension / add an alias / rename at the source*.
6. **Prefer fixing at the source or published data source**, not per-workbook — a rename or re-type in one embedded copy doesn't help the next workbook.

### Confirmed example

A data source with fields `order_date (string)`, `sales_amt (string)`, `cust_id (measure)`, `customerName (string)`, and 28 other raw snake_case fields:

- **High:** `order_date` is a string → no date math or relative-date filters; re-type to date at the source. `sales_amt` is a string → can't SUM; re-type to real/integer.
- **Medium:** `cust_id` is a measure → will be summed by default; change to dimension. `cust_id` is also a cryptic abbreviation → alias to `Customer ID`.
- **Systemic (Low, escalated):** 30 of ~32 fields are raw snake_case (>50%) → connected without name cleaning; recommend aliasing at the source rather than 30 per-workbook renames.

**What does NOT work:**
- **Substring matching** — flagging `"considered"` as an ID or `"update_frequency"` as a date. Always match on word boundaries.
- **Flagging an intentional cast** — a calc `STR([Date])` named `date_label` is a string on purpose; read the formula before calling it a mismatch.
- **Listing every field separately** — 40 individual naming dings read as noise and get ignored; collapse to systemic findings.
- **Fixing type/role in one workbook's embedded copy** — the next workbook on the same source inherits the same bad field. Fix upstream.
- **Renaming a Salesforce `__c` field by editing the source schema** — you alias it in Tableau (or the published source); you don't touch the API name.

## Best Practices

- **Type correctness before naming.** A mis-typed field produces *wrong answers*; a badly-named one only produces friction. Triage accordingly.
- **Infer from the name, verify against the store.** The name is the intent; the stored type/role is the reality; the gap is the finding.
- **Guard against false positives** — word boundaries, intentional casts, parameter exemptions — before you raise anything.
- **Aggregate systemically** — one finding for a pervasive pattern, with examples, beats a flat list.
- **Fix upstream.** Prefer a re-type/alias at the source or published data source so every downstream workbook benefits.

## Common Mistakes

1. **Substring instead of word-boundary matching** — `id` inside `"considered"`, `date` inside `"candidate"`, producing false flags.
2. **Calling an intentional string cast a "mismatch"** — a calc that deliberately `STR()`s a value is not a defect.
3. **Field-by-field noise** — reporting 30 individual snake_case fields instead of one systemic finding.
4. **Fixing per-workbook** — re-typing in one embedded copy while every other workbook on the source keeps the bad field.
5. **Treating naming smells as correctness bugs** — a `camelCase` name is a readability nit; deducting from it as if it broke a number is miscalibrated.

## Source and Confidence

- Source/evidence type: community-adapted best practice
- Source: Field naming-violation and type/role-mismatch heuristics adapted from `adammico-lab/Tableau-Data-Quality-Sentinel-BETA` (Adam Mico, Apache 2.0), curated to house format; site-scanning / REST-API mechanics from that source deliberately excluded as out of scope for a Desktop authoring KB. Pattern set and systemic-aggregation rule are the source's, de-branded and condensed.
- Customer-identifying details removed: yes
- Confidence: SME-reviewed
- Last reviewed: 2026-07-13
