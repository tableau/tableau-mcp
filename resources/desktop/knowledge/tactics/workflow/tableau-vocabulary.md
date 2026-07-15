# Tableau Vocabulary for User-Facing Narration

Tableau users should hear product vocabulary, not implementation vocabulary, in agent narration, tool explanations, and errors.

## Scope Check

- Primary audience: Tableau agent and end-user communication
- Authoring outcome improved: clearer status, errors, and tool explanations
- In-scope reason: Tableau users should hear product vocabulary, not implementation vocabulary.
- Out-of-scope risk: Internal code, parameter names, tool identifiers, API fields, and stored workbook formats can still use implementation terms where required.
- Tags: vocabulary, user-facing, tableau-speak, narration, errors, shelves, data-types
- Relevant user prompts/search terms: "never say XML", "use Tableau vocabulary", "Columns not cols", "Rows shelf", "viz not chart", "Number (whole)", "Number (decimal)", "Text", "True/False"

## When to Use

Use this whenever composing text that a Tableau user may see: progress updates, error messages, final summaries, clarification questions, tool titles, and tool descriptions. The rule applies even when the underlying implementation is manipulating workbook markup or a failure happened in the parser/serializer layer. Translate the implementation detail into the Tableau object the user recognizes.

## Best Practices

- Say **workbook**, **worksheet**, **dashboard**, **sheet**, **viz**, **field**, **Rows**, **Columns**, **Marks**, or **filter** instead of naming the underlying file format.
- Use the product shelf names **Rows** and **Columns** in user-facing narration. If a tool parameter must remain `rows` or `cols`, explain it as `target=rows` for the Rows shelf or `target=cols` for the Columns shelf.
- Say **viz** instead of **chart** unless quoting a user, a file name, or a fixed tool or template identifier that cannot be renamed.
- Use Tableau UI data type names: **Number (whole)**, **Number (decimal)**, **Date**, **Date & Time**, **Text**, and **True/False**.
- Phrase failures around the affected Tableau object and next action: "The workbook update failed validation" or "The worksheet could not be applied" gives the user a useful anchor.

| Banned or internal wording | Preferred user-facing wording |
| --- | --- |
| XML | workbook, worksheet, dashboard, sheet, viz, or field, depending on what changed |
| XML validation failed | workbook update failed validation / worksheet update failed validation |
| cols | Columns |
| rows | Rows |
| chart | viz |
| integer | Number (whole) |
| real / float / decimal | Number (decimal) |
| datetime | Date & Time |
| string | Text |
| boolean / bool | True/False |

Confirmed-working rewrite example:

```text
Bad: The modified XML failed validation, so I could not load the chart with cols set to Sales.
Good: The worksheet update failed validation, so I could not update the viz with Sales on Columns.
```

## Common Mistakes

1. **Exposing the implementation layer in an error.** "The XML failed validation" may be technically precise, but it does not tell a Tableau user what object is affected.
2. **Using shorthand shelf names.** "cols" and "rows" are useful inside code and parameter names, but users see **Columns** and **Rows** in Tableau.
3. **Calling every viz a chart.** Tableau's product language and design feedback prefer **viz** for user-facing narration.
4. **Leaking raw datatypes.** "string" and "integer" are implementation or datastore words; Tableau presents these as **Text** and **Number (whole)**.

What does NOT work: replacing every internal occurrence globally. Tool parameter names, command names, cache filenames, and source-code variables may contain fixed implementation vocabulary. Only translate the text that can reach a user or an agent-facing instruction surface.

## Implementation

Before returning a user-facing message, scan for implementation vocabulary and translate it to the closest Tableau object:

1. Identify the affected object: workbook, worksheet, dashboard, viz, field, shelf, filter, or Marks card.
2. Replace internal format terms with that object name.
3. Replace shelf shorthand with **Rows** or **Columns**.
4. Replace raw data type names with the Tableau UI names.
5. Keep fixed API names unchanged when required, but surround them with user vocabulary: "Set `target=cols` to put the field on Columns."

For validation errors, use this pattern:

```text
The <workbook/worksheet/dashboard> update failed validation with <N> error(s).
<details if useful>
Fix these issues before applying the update.
```

## Source and Confidence

- Source/evidence type: design-partner feedback
- Source: Ginger feedback that Tableau users should not see implementation vocabulary; product vocabulary confirmed by Tableau UI labels
- Customer-identifying details removed: yes
- Confidence: SME-reviewed
- Last reviewed: 2026-07-12
