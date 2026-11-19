---
sidebar_position: 2
---

# Match Template

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Builds a chart from a plain-language ask by matching it to a reusable authoring template. The tool reads the workbook open in %product_name%, resolves the fields named in the ask itself, and matches the ask to a fast-path template — then either returns the bound template arguments for you to apply, or (with `auto_apply`) applies the finished chart to the live workbook in one step. It works in up to two calls: a first call with just the ask, and — when no template matches deterministically — a second call carrying a chosen `proposal`.

Each call reports one outcome in its `status` field:

- `bound` — the ask matched a template and every slot is filled; the response carries the bound arguments (and, when `auto_apply` succeeded, an applied receipt).
- `propose` — no deterministic match; the response lists candidate templates and the fields to bind, for you to choose one and call again with a `proposal`.
- `escalate` — no fast-path template fits the ask or data; the response routes you to the template artifact path: [`list-templates`](./list-templates.md) → [`list-available-fields`](../fields/list-available-fields.md) → [`build-worksheets-from-templates`](../template/build-worksheets-from-templates.md) → [`apply-worksheet`](../worksheet/apply-worksheet.md).
- `blocked` — this MCP server refused the call before writing a chart: a repeated or unchanged retry, a proposal that breaks the returned contract, a filter it could not resolve, a pie with too many slices, or a request it could not prove complete. See [Blocked reasons](#blocked-reasons).

:::note[Mutates the workbook]
This tool is not read-only and not idempotent. With `auto_apply: true` it writes the bound chart to the live workbook, and any `calcs` are authored into the workbook before the bind — both mutate the open document. A completed apply re-run is a real re-mutation, not a no-op.
:::

## APIs called

This tool acts on the workbook open in the local %product_name% instance, communicating with %product_name% directly rather than calling the Tableau Cloud or Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. These loopback calls carry **no OAuth scopes**; each is authorized by the running %product_name% instance's **per-session bearer token** over the loopback interface. A workbook must be open in the target session. Matching the ask to a template and building the workbook XML happen in-process; only the reads and writes below cross to %product_name%.

- Reads the open workbook once so the tool can resolve fields and match a template. Also done every time, before any bind.
  - `GET /v<x>/workbook/document` — read the current workbook XML. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)
- Matches the ask to a template and binds each slot to a resolved field — done in-process against the read workbook XML and the bundled template library (not an API call). The `propose`/`escalate`/`blocked` outcomes are all resolved here without further calls.
- Authors pre-bind calculations into the workbook (only when `calcs` is supplied): the edited workbook is applied, then re-read to confirm the new fields landed.
  - `POST /v<x>/workbook/document` (`Content-Type: application/xml`) — apply the workbook with the authored calculations. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/applyWorkbookDocument)
  - `GET /v<x>/workbook/document` — re-read to confirm the calculations were applied. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)
- Checks whether the user changed the workbook after it was read, before an `auto_apply` write (the apply is whole-document last-writer-wins, so a concurrent edit would be silently reverted). This change-event gate has no %ecapi_name% endpoint — it is not an API call and is skipped on transports without event support.
- Applies the bound chart to the live workbook (only when `auto_apply: true`, the result is `bound`, and the matched template is fast-path eligible): the template is injected and any sort/top-N is spliced into the workbook XML, the whole document is validated in-process (not an API call), then posted back. On any inject/validation/apply failure the tool falls back gracefully — the bound arguments are returned intact so no bind is lost.
  - `POST /v<x>/workbook/document` (`Content-Type: application/xml`) — apply the updated workbook XML. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/applyWorkbookDocument)
- Navigates to the newly applied sheet (best-effort follow-up after a successful apply; a failure here never changes the applied result). The Start Page is hidden first, because it stays over the document after a write.
  - `POST /v<x>/app:toggleStartPage` — hide the Start Page. Skipped on API versions before 0.2.11. [API reference](ext://eca/reference/index.html#tag/Application/operation/toggleStartPage)
  - `GET /v<x>/workbook/document` — re-read to confirm the sheet exists and is not already active. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)
  - `GET /v<x>/workbook` — read the sheet inventory to resolve the sheet name to its id. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbook)
  - `POST /v<x>/workbook:goToSheet` — focus the newly applied sheet. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/goToSheet)
  - `GET /v<x>/workbook/document` — re-read to confirm the sheet took focus. If it did not, the tool resolves the id and calls `goToSheet` once more. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)
- Reads the applied sheet's summary data back to fill `summary_rows` (a failure is reported on `summary_rows_error` and never changes the applied result).
  - `GET /v<x>/workbook/worksheets` — resolve the applied sheet's id. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/listWorksheets)
  - `GET /v<x>/workbook/worksheets/{id}/summaryData` — read the summary rows. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/getWorksheetSummaryData)

## Required arguments

### `ask`

The ask: a plain-language description of the chart to build, for example `"bar chart of Sales by Region"`. The tool resolves the fields named in the ask against the open workbook and matches the ask to a fast-path template. This is the only always-required argument; a `proposal` is added only on the second call after a `propose` outcome.

#### Example

```json
{ "ask": "bar chart of Sales by Region" }
```

## Optional arguments

### `session`

The %product_name% session to target (Desktop PID). Omit when the session is pinned or exactly one %product_name% instance is connected — it is resolved automatically. When two or more are connected the tool fails closed and lists the running instances rather than guessing; a value that is not a running instance is rejected.

#### Example

`"12345"`

<hr />

### `proposal`

The second-call payload that selects one template and binds every slot to a field, used after a `propose` outcome returned candidate templates. Its nested fields mirror the returned proposal schema verbatim (snake_case inside `bindings`), so a `propose` payload round-trips unchanged:

- `template` — the chosen template name.
- `title` — the sheet title. Maximum 80 characters; control characters are rejected.
- `bindings` — an array of `{ slot_id, field }`, one per bound slot, using exact field names. Each binding can add a `derivation` override, which must be one of the canonical derivation short forms (for example `sum`, `avg`, `cnt`, `yr`).
- `confidence` — required. The match confidence. `Range: 0-1`.
- `sort` — optional `{ by, direction }` where `direction` is `"asc"` or `"desc"`.
- `top_n` — optional positive integer to keep only the top N members.
- `bin_size` — optional positive number for a binned slot.
- `filters` — optional array of `{ field, values?, context? }`. `values` is a list of member strings; omit it for a filter control that lists every member. `context: true` makes it a context filter.
- `template_parameters` — optional string-to-string map that fills `{{KEY}}` tokens in the template, for example `{ "DATE_MIN": "2024-01-01" }`.

The proposal is strict: an unknown key at any level is rejected rather than dropped.

#### Example

```json
{
  "proposal": {
    "template": "ranking-ordered-bar",
    "title": "Sales by Region",
    "bindings": [
      { "slot_id": "field_base_1", "field": "Region" },
      { "slot_id": "field_base_2", "field": "Sales" }
    ],
    "confidence": 0.9
  }
}
```

:::note[Confidence is required]
`confidence` must be present in a `proposal`. The matcher skips its low-confidence floor when confidence is undefined, so omitting it would bypass the escalation entirely — the schema rejects a proposal without it.
:::

<hr />

### `minConfidence`

The minimum confidence floor for accepting a match. `Range: 0-1`.

#### Example

`0.8`

<hr />

### `auto_apply`

Boolean (schema description: "Apply now."). When `true` and the ask binds to a fast-path-eligible template, the bound chart is applied to the live workbook in one step and the response is a trimmed applied receipt (`applied: true`, `sheet_name`, `phase_ms`). When `false` or omitted, the tool returns the bound arguments and guidance without mutating the workbook.

#### Example

`true`

#### Applies only fast-path-eligible binds

`auto_apply` applies only a `bound` result whose matched template is fast-path eligible. A `propose`, `escalate`, or `blocked` outcome — or a bound result on a template that is not fast-path eligible — is returned unapplied even when `auto_apply: true`.

#### Refuses to overwrite concurrent edits

The apply is a whole-document write. If the user changes the workbook between the read and the apply, the tool refuses to apply, keeps the bound arguments intact, and directs you to re-run so it reads the current workbook. It does not offer to re-apply the returned arguments in this case, because they were computed against the pre-edit workbook and would revert the user's changes.

#### Graceful fallback on apply failure

If the inject, validation, or apply write fails, the response is `applied: false` with an `apply_error` and the bound `args`, so you can take the template artifact path.

<hr />

### `requireCompleteRequest`

When `true`, the tool binds only if it can prove the whole ask is covered by one direct bind; otherwise it declines without writing anything. The decline is a `blocked` result with `reason: "request_not_covered"`, `applied: false`, `may_have_applied: false`, `writeAttempts: 0`, and a `requestCoverage` record carrying the SHA-256 of the ask.

The tool declines at once, before reading the workbook, when `requireCompleteRequest` is `true` and any of these hold:

- `auto_apply` is not `true`.
- Any of `proposal`, `calcs`, `skip_validation`, `keep_large_pie`, `target_worksheet`, or `datasource` is set.
- An earlier call for the same ask in this session left a proposal or recovery record open.

#### Example

```json
{ "ask": "bar chart of Sales by Region", "auto_apply": true, "requireCompleteRequest": true }
```

<hr />

### `skip_validation`

When `true`, the call requests that in-process validation of the bound document be skipped before apply (_available September 2026 and later_). The server honors this only when it has been configured to allow skipped validation; otherwise the flag is ignored and validation still runs. Omit it (or pass `false`) to keep the normal validation path.

Do not use this to work around a bind that fails validation — fix the mapping instead.

#### Example

`true`

<hr />

### `keep_large_pie`

User-confirmed big pie (_available November 2026 and later_). Set `true` only when resubmitting the same ask and the same pie proposal the tool already blocked because the pie has more slices than the workable maximum of 12, and only after the user explicitly says they want that pie. Keep the same `datasource` and `target_worksheet`. The confirmation applies only to that blocked proposal.

#### Example

`true`

<hr />

### `target_worksheet`

An existing worksheet to replace in place, given as its id or its name; omit to create a new sheet (_available September 2026 and later_ for matching by id). Validated before the bind runs, for both apply modes: the value must resolve to an existing worksheet, and it must not be a sheet that belongs to a dashboard. An unknown name or id, or a dashboard-member sheet, is refused with a precise reason rather than silently creating a stray copy.

#### Example

`"Sales by Region"`

:::note[Refusals]
Checked against the open workbook before the bind runs. The name in the message is the sheet's name when the value matches a worksheet, and the value you passed when it does not.

- `target_worksheet "<target_worksheet>" not found in the workbook — check get-sheets, or omit target_worksheet to create a new sheet`
- `target_worksheet "<name>" is a dashboard member sheet — replacing it in place could corrupt the dashboard; omit target_worksheet to create a new sheet`
:::

<hr />

### `datasource`
Internal datasource name or unique caption to use as the calc source when authoring pre-bind calculations.

#### Example

`"Sample - Superstore"`

:::note[Refusals]
`datasource` is resolved before any calculation is authored. A follow-up for the same ask must keep the datasource already retained, including a confirmed large-pie resubmit. When `calcs` is set and `datasource` is omitted, the calculation authoring chooses the target and refuses if it cannot.

- `datasource "<name>" not found or ambiguous in the workbook; use an internal datasource name or unique caption`
- `datasource must match the retained bind-template datasource "<name>"`
- `Multiple datasources found; specify datasource. Candidates: <names>.` — `calcs` is set, `datasource` is omitted, and more than one datasource other than `Parameters` exists. The message lists up to five names
- `No non-Parameters datasource found.` — `calcs` is set and the workbook has no datasource other than `Parameters`
- `Datasource "<name>" was not found. Candidates: <names>.` and `Datasource caption "<caption>" is ambiguous. Use an internal datasource name: <names>.` — the calculation-authoring helper's wording when it is given a name directly. This tool resolves `datasource` first and uses the `not found or ambiguous` message above
:::

<hr />

### `calcs`

Calculated fields to author into the workbook before the bind (schema description: "Author fields."), so the ask can reference them. Each entry is:

- `caption` — the field caption to create.
- `formula` — the calculation formula.
- `datatype` — optional field data type.
- `role` — optional field role.

Invalid calculations (for example an empty formula) are rejected before any document load or bind. Authored calc captions are echoed back in `authored_calcs`.

#### Example

```json
{
  "calcs": [
    { "caption": "Margin", "formula": "[Sales] * 0.2" }
  ]
}
```

:::note[Refusals]
Each calculation is checked before the workbook is changed. A message for a calculation that has a caption is prefixed with `calc "<caption>": `. An empty caption is prefixed with `calc "#<n>": `, where `<n>` is the 1-based position in `calcs`. An existing field with the same caption, formula, role, and datatype is reused.

- `caption empty`
- `formula empty`
- `invalid role` — `role` is not `measure` or `dimension`
- `invalid datatype` — `datatype` is not `real`, `integer`, `string`, `boolean`, `date`, or `datetime`
- `caption collision — pick a new caption or use the existing field` — a field with that caption already exists and does not match this calculation
- `field reference [<name>] was not found` or `field reference [<name>] is ambiguous` — an unbracketed name in the formula does not resolve to one field. When the workbook has candidates, the message continues with ` <one of: ...>` and lists up to three names
- `field reference [<name>] is ambiguous between parameters: <names>` — the name matches more than one parameter
:::

## Notes and caveats

- **`propose` and `escalate` are normal outcomes, not errors.** They report that the tool needs a chosen proposal or that no fast-path template fits — the response's `guidance` names the next step. Only a genuine failure (for example a failed workbook read) is returned as an error.
- **Retries and unsafe proposals are blocked by this MCP server, not by %product_name%.** It tracks bind attempts per ask. To proceed, follow the `guidance`: change the proposal, ask the user, or take the template artifact path.

### Blocked reasons

A `blocked` result writes no chart. Calculations passed in `calcs` are authored first, so they may already be in the workbook. `reason` is one of:

- `awaiting_proposal` — a second call for the same ask came without a `proposal`. The choices from the first call are repeated in `call_2_contract`.
- `unchanged_proposal` — the proposal is the same as the one that already failed. Changing only `title` or `confidence` does not count.
- `retry_budget_exhausted` — the proposal repeats an earlier attempt, or the limit on distinct corrections is used up.
- `fallback_required` — the ask cannot be bound in the fast path: two calls in a row came without a proposal, the one allowed correction did not bind, or the ask was already found not recoverable. Use the template artifact path.
- `ambiguous_filter_intent` — a filter in the ask is ambiguous, unresolved, matches fields in more than one datasource, or goes past the five-filter limit.
- `proposal_contract_mismatch` — the proposal uses a template, slot, or field that `call_2_contract` did not offer, leaves out a required slot, or changes the required filter fields. `mismatches` lists each problem.
- `proposal_filter_resolution_failed` — a filter in the proposal does not resolve to one dimension. `blockers` lists the candidates.
- `pie_slice_limit` — the pie would have more than 12 slices. Offer a sorted bar, or resubmit with `keep_large_pie: true` only after the user confirms.
- `request_not_covered` — `requireCompleteRequest` was set and the tool could not prove the whole ask is covered (see [`requireCompleteRequest`](#requirecompleterequest)).
- **A reused sheet that still needs calculations cannot be a dashboard member.** When `target_worksheet` is omitted and the ask matches a sheet already applied, a dashboard member that still has calculations waiting to be authored is refused: `deterministic worksheet "<title>" is a dashboard member sheet with pending calculations — missing calculations prevent safe reuse, and the dashboard member cannot be rebuilt in place`.
- **Summary rows after apply.** The summary read is called with the applied sheet's title and without a column list. A failure from that read is returned on `summary_rows_error`. The helper's blank-worksheet message and its requested-column messages are not used on this call.

## Example results

### Bound, not applied (`auto_apply` omitted)

```json
{
  "status": "bound",
  "used_llm": false,
  "args": {
    "template_name": "ranking-ordered-bar",
    "title": "Sales by Region",
    "sheet_type": "worksheet",
    "template_parameters": { "DATASOURCE": "Superstore" },
    "field_mapping": {
      "{{field_base_1}}": "[Superstore].[none:Region:nk]",
      "{{field_base_2}}": "[Superstore].[sum:Sales:qk]"
    }
  },
  "guidance": "NOT APPLIED — the worksheet is unchanged. Resubmit this exact bind-template call with auto_apply:true to apply the bind."
}
```

### Bound and applied (`auto_apply: true`)

```json
{
  "status": "bound",
  "applied": true,
  "sheet_name": "Sales by Region",
  "phase_ms": { "bind": 42, "inject": 7, "apply": 118 },
  "guidance": "Applied \"Sales by Region\" to the live workbook (bind 42ms, inject 7ms, apply 118ms). Done — no further tool calls needed."
}
```

### Propose (no deterministic match)

`llm_input` and `call_2_contract` are trimmed here to one candidate template.

```json
{
  "status": "propose",
  "decline_reason": {
    "code": "no_llm_classifier_declined",
    "detail": "classifyNoLlm returned no deterministic template; routed to proposal candidates"
  },
  "llm_input": {
    "ask": "how are sales doing across regions",
    "candidate_templates": [
      {
        "template": "ranking-ordered-bar",
        "description": "ranking ordered bar",
        "intent_keywords": ["ranking ordered bar", "ranking", "rank", "ordered", "order", "bar", "sorted-bar", "bar-chart"],
        "slots": [
          { "slot_id": "field_base_1", "role": ["rows"], "kind": "categorical", "required": true, "derivation": "none" },
          { "slot_id": "field_base_2", "role": ["cols"], "kind": "quantitative", "required": true, "derivation": "sum" }
        ]
      }
    ],
    "fields": [
      { "name": "Region", "role": "dimension", "type": "nominal", "datatype": "string" },
      { "name": "Sales", "role": "measure", "type": "quantitative", "datatype": "real" }
    ]
  },
  "output_schema": { "type": "object" },
  "call_2_contract": {
    "tool": "bind-template",
    "arguments": {
      "session": "12345",
      "ask": "how are sales doing across regions",
      "auto_apply": true
    },
    "proposal_choices": [
      {
        "template": "ranking-ordered-bar",
        "slots": [
          { "slot_id": "field_base_1", "required": true, "compatible_field_names": ["Region"] },
          {
            "slot_id": "field_base_2",
            "required": true,
            "compatible_field_names": ["Sales"],
            "conditional_field_options": [{ "name": "Region", "requires_derivation": ["cnt", "ctd"] }]
          }
        ]
      }
    ],
    "proposal_requirements": {
      "title": "Choose a worksheet title.",
      "confidence": "Set a confidence from 0 to 1.",
      "field_selection": "Choose an exact compatible_field_names value, or a conditional_field_options name with its required derivation; do not rename fields."
    }
  },
  "guidance": "Call 1 requires a proposal. Choose one call_2_contract proposal choice, bind its exact slot IDs to exact compatible field names, and make Call 2 with the same ask/target, proposal, and top-level auto_apply:true. top_n ranks; filters[].context scopes filters. No recommendation is available. If a required choice remains ambiguous, call ask-user; do not guess. set derivation ONLY when the ask explicitly requests an aggregation/date grain different from the template default. Do not call other authoring tools between calls."
}
```

### Escalate (field not found)

```json
{
  "status": "escalate",
  "reason": "field-not-found",
  "blockers": [
    { "code": "field-not-found", "slot_id": "field_base_2", "detail": "no field named \"Revenue\" in datasource(s)", "candidates": [] }
  ],
  "guidance": "Escalated (field-not-found). No worksheet was produced. Blockers: [field-not-found] slot 'field_base_2' no field named \"Revenue\" in datasource(s). Next: use the guarded artifact path: list-templates, list-available-fields, build-worksheets-from-templates, then apply-worksheet. This is a normal path, not a failure."
}
```

### Blocked (unchanged retry)

```json
{
  "status": "blocked",
  "reason": "unchanged_proposal",
  "guidance": "Blocked: this proposal is semantically unchanged from the failed bind attempt. Title/confidence only changes do not count; change a binding, derivation, sort, or top_n based on evidence, otherwise ask-user or use list-templates, list-available-fields, build-worksheets-from-templates, then apply-worksheet."
}
```

## Related

- [`resolve-field`](../fields/resolve-field.md) — resolve an ambiguous or not-found field before re-proposing.
- [`add-field`](../fields/add-field.md) — place a field on a worksheet in the manual authoring path.
- [`list-templates`](./list-templates.md) — find a template in the fallback authoring path.
- [`build-worksheets-from-templates`](../template/build-worksheets-from-templates.md) — build a worksheet artifact from a template in the fallback authoring path.
- [`apply-worksheet`](../worksheet/apply-worksheet.md) — apply the built worksheet in the fallback authoring path.
- [`refine-worksheet`](../worksheet/refine-worksheet.md) — apply a bounded sort/top-N refinement to an existing worksheet.
