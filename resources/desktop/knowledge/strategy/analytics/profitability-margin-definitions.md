# Profitability Margins: Gross vs Operating vs Net

A "margin" is profit-over-revenue, but *which* profit depends entirely on which costs you subtract — and the three common margins are routinely conflated. Ask "show me margin %" without pinning the definition and you can build a beautiful, correct-looking chart that answers the wrong question. This is a business-definition companion to the aggregate-ratio mechanics: the arithmetic (`SUM/SUM`, guard the zero denominator) is the same for all three; only the numerator's cost set changes.

Tags: gross-margin, operating-margin, net-margin, profitability, cogs, opex, ratio-kpi, finance-metrics

**Tactics companion:** `expertise://tableau/tactics/data/aggregate-ratio-window-total-semantics` — the ratio-of-sums arithmetic and zero-denominator guard every margin calc uses.

## Scope Check

- Primary audience: Tableau user / SE assisting a Tableau user
- Authoring outcome improved: calculate, validate, troubleshoot
- In-scope reason: Pins the business definition of gross / operating / net margin so the agent subtracts the correct cost set when a user asks for "margin %", preventing a syntactically-correct calc that answers the wrong question.
- Out-of-scope risk: none — arithmetic mechanics defer to the aggregate-ratio tactics file.
- Tags: gross-margin, operating-margin, net-margin, contribution-margin, profitability, cogs, opex, sg-and-a, ratio-kpi, finance-metrics, margin-percent
- Relevant user prompts/search terms: "show me gross margin %", "margin percentage", "profitability by product", "gross vs operating margin", "which costs go into gross margin", "operating margin calculation", "net margin", "contribution margin", "why is my margin too low", "COGS margin", "profit margin by region"

## When to Use

Reach for this whenever a request names a **margin or profitability rate** without fully specifying the cost set:

- "Show me gross margin %" / "margin by product" / "profitability" — the classic underspecified ask.
- The datasource carries **several cost columns** (e.g. `cogs`, `s_and_m`, `r_and_d`, `g_and_a`) and you must decide which belong in the numerator.
- A margin number looks "too low" — often because operating expenses were subtracted when gross was intended (or vice versa).

If the user names the exact margin *and* the data has a single obvious cost, skip this and just author the ratio.

## Best Practices

1. **Gross margin excludes operating expenses.** Gross margin % = `(SUM([revenue]) - SUM([cogs])) / SUM([revenue])`. Only the **cost of goods sold** (direct cost of producing what was sold) is subtracted. Sales & marketing, R&D, and G&A are operating expenses and do **not** belong in gross margin.
2. **Operating margin subtracts operating expenses too.** Operating margin % = `(SUM([revenue]) - SUM([cogs]) - SUM([s_and_m]) - SUM([r_and_d]) - SUM([g_and_a])) / SUM([revenue])`. This is operating income (EBIT-ish) over revenue — it sits below gross on the income statement.
3. **Net margin is the bottom line.** Net margin % subtracts *everything* — operating expenses plus interest and taxes — over revenue. Only compute it when those columns exist; don't fabricate them.
4. **Contribution margin is a fourth, different idea.** Contribution margin subtracts only **variable** costs (not all COGS, not fixed opex). If the data doesn't distinguish variable from fixed, say so rather than guessing.
5. **When the data has multiple cost columns and the ask is bare, pin the definition before building.** Either state the assumption plainly ("computing gross margin = (revenue − COGS) / revenue; say the word for operating margin") or ask one clarifying question — never silently fold opex into a "gross" ask.
6. **The arithmetic is always ratio-of-sums with a zero guard.** All margins are `SUM(profit_of_some_kind) / SUM(revenue)` — sum the parts first, then divide (never `AVG(row ratio)`), and guard `SUM([revenue]) = 0`. See the tactics companion.

## Common Mistakes

1. **Subtracting operating expenses for a "gross margin" ask.** Folding `s_and_m` / `r_and_d` / `g_and_a` into the numerator computes *operating* margin and is wrong for "gross" even if the chart is beautiful. This is the single most common margin error.
2. **Averaging row-level margins.** `AVG([margin])` weights a $10 order the same as a $10M order. Use `SUM(numerator) / SUM(denominator)`.
3. **Unguarded divide by zero.** A period or product with zero revenue silently errors or drops. Wrap with `IIF(SUM([revenue]) = 0, NULL, …)` or flag it.
4. **Inventing cost columns.** If only `revenue` and `cogs` exist, you can compute gross margin — not operating or net. Never fabricate an opex column; say what's computable.
5. **Confusing margin (÷ revenue) with markup (÷ cost).** Margin is profit over *revenue*; markup is profit over *cost*. "40% margin" ≠ "40% markup."

## Implementation

1. Identify the margin the user means; if the ask is bare and the data has multiple cost columns, state the assumption (default to **gross**: revenue − COGS) or ask one question.
2. Author the calc through the no-XML authoring verb (`author-calc`), never hand-spliced XML: `(SUM([revenue]) - SUM([cogs])) / SUM([revenue])` for gross, extending the subtracted set for operating/net.
3. Guard the zero denominator and format as a percentage.
4. Report which margin you built and which costs it subtracts, so the user can correct the definition in one word.

## Related Knowledge

- `expertise://tableau/tactics/data/aggregate-ratio-window-total-semantics` — the ratio-of-sums arithmetic, zero-denominator guard, and grand-total behavior every margin calc relies on.
- `expertise://tableau/strategy/analytics/calc-authoring-best-practices` — the zero-denominator guard pattern and calc-authoring discipline.
- `expertise://tableau/tactics/data/calc-fields` — the XML/authoring mechanics for calculated fields.

## Source and Confidence

- Source/evidence type: internal-doc synthesis + standard financial-statement definitions
- Source: standard income-statement margin definitions (gross/operating/net), consolidated with this repo's aggregate-ratio and calc-authoring modules
- Customer-identifying details removed: yes
- Confidence: draft
- Last reviewed: 2026-07-21
