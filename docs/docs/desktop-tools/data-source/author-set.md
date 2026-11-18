---
sidebar_position: 5
---

# Author Set

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Authors a set on a dimension in the workbook open in %product_name% and applies it to the live workbook. Once created, the set can be referenced by its caption as a filter or color field, or in a later bind-template ask.

The `mode` argument selects which kind of set is authored:

- `top-n` (default) — a computed set that ranks the dimension's members by a measure expression and keeps the top or bottom N of them. The count can be a literal integer for a fixed-N set or a parameter reference so the set stays param-linked.
- `empty` — a set that starts out with no members, ready to be filled later (by a set action, for example).
- `condition` — a rule-based set that keeps members for which a measure expression is true, for example `SUM([Sales]) >= 60000`.

:::note[Not read-only]
This tool is not read-only and not idempotent. It modifies the workbook open in the live %product_name% session by adding a new set, and each successful call adds another set.
:::

## APIs called

This tool acts on the workbook open in the local %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: each call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface. The tool reads the current workbook, splices the new set into the chosen datasource, applies the whole document, and then reads back to confirm the set was added.

- Reads the current workbook's XML from the running %product_name% session, then locates the target datasource and checks for a caption collision.
  - `GET /v<x>/workbook/document` — read the open workbook's XML. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)
- Validates the edited workbook document before anything is sent to %product_name% — validated in-process (not an API call). This guards against dropping worksheets or submitting a fragment.
- Applies the whole edited workbook document to the open %product_name% workbook, replacing it with the version that contains the new set.
  - `POST /v<x>/workbook/document` — replace the open workbook from the posted document (`Content-Type: application/xml`). [API reference](ext://eca/reference/index.html#tag/Workbook/operation/applyWorkbookDocument)
- Reads the workbook back to confirm the new set's name and caption are present; if they are not, the tool reports that the load did not apply.
  - `GET /v<x>/workbook/document` — re-read the open workbook to verify the set. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)

## Required arguments

### `caption`

The display name for the set. Used as the set's caption and to derive its internal set name (`[caption]`). Must be non-empty.

#### Caption collisions

:::note[Refusals]
The caption is checked before the workbook is read, and again against the target datasource before anything is written.

- `caption empty` — the caption is empty after trimming
- `caption collision — pick a new caption or use the existing set` — a set or group with that caption already exists
- `caption collision — a field with that name already exists; pick a new caption` — a column, local name, or group already uses that name or caption, compared without regard to case
:::

#### Example

```json
{ "caption": "Top N Sub-Category Set" }
```

<hr />

### `dimension`

The dimension field whose members the set is built from, for example `Sub-Category`. In `top-n` mode its members are ranked and enumerated; in `empty` mode it is the dimension the empty set is defined against; in `condition` mode it is the dimension whose members the expression filters. The value is wrapped in brackets automatically if it is not already a bracketed reference. Must be non-empty.

:::note[Refusals]
An empty dimension is refused with `dimension empty`.
:::

#### Example

```json
{ "dimension": "Sub-Category" }
```

## Optional arguments

### `mode`

Which kind of set to author. One of `top-n`, `empty`, or `condition`. Defaults to `top-n`.

This argument decides whether the ranking and condition arguments apply: `orderBy` and `count` are required in `top-n` mode and refused in `empty` and `condition` modes; `conditionExpression` is required in `condition` mode and refused otherwise; `end` shapes only a `top-n` set.

#### Example

`"empty"`

<hr />

### `orderBy`

The measure expression used to rank the dimension's members, for example `SUM([Profit])`.

**Required in `top-n` mode**, where it must be non-empty. **Must not be supplied in `empty` or `condition` mode** — those sets have nothing to rank, so passing `orderBy` (or `count`) there is refused before the workbook is read.

:::note[Refusals]
A blank string is treated as omitted.

- `orderBy is required in top-n mode`
- `orderBy and count cannot be supplied in empty mode`
- `orderBy and count cannot be supplied in condition mode`
:::

#### Example

```json
{ "orderBy": "SUM([Profit])" }
```

<hr />

### `count`

How many members the set keeps. Either a literal integer such as `5` for a fixed-N set, or a parameter reference token such as `[Parameters].[Parameter 3]` to param-link the count so it follows a workbook parameter. The value is emitted verbatim, so a bare integer is a fixed N while a parameter reference is resolved by %product_name% at runtime.

**Required in `top-n` mode**, where it must be non-empty and must be either a positive integer or a `[Parameters].[Name]` reference; anything else is refused. **Must not be supplied in `empty` or `condition` mode.**

:::note[Refusals]
A parameter reference matching `[Parameters].[Name]` is written through as-is: the tool does not check that the parameter exists or that its live value is a usable count. Any other non-empty value that is not a positive integer is refused with `count must be a positive integer in top-n mode`. An omitted or blank `count` in `top-n` mode is refused with `count is required in top-n mode`.
:::

#### Example

```json
{ "count": "[Parameters].[Parameter 3]" }
```

<hr />

### `conditionExpression`

The boolean measure expression that selects members of the set, for example `SUM([Sales]) >= 60000`.

**Required in `condition` mode**, where it must be non-empty. **Must not be supplied in `top-n` or `empty` mode.**

:::note[Refusals]
A blank string is treated as absent.

- `conditionExpression is only valid in condition mode`
- `conditionExpression is required in condition mode`
:::

#### Example

```json
{ "conditionExpression": "SUM([Sales]) >= 60000" }
```

<hr />

### `end`

Which end of the ranking the set keeps: `top` or `bottom`. Defaults to `top`. Applies only in `top-n` mode, since an empty set has no ranking to trim.

- `top` — keep the highest-ranked members.
- `bottom` — keep the lowest-ranked members.

#### Example

`"bottom"`

<hr />

### `datasource`
Internal datasource name or unique caption of the datasource to author the set into. When omitted, the tool auto-selects the single non-`Parameters` datasource in the workbook; if there is more than one, it returns an error listing the candidate names so you can specify one.

:::note[Refusals]
Candidate names in these messages are limited to five.

- `Datasource caption "<caption>" is ambiguous. Use an internal datasource name: <names>.`
- `Datasource "<name>" was not found. Candidates: <names>.`
- `Multiple datasources found; specify datasource. Candidates: <names>.`
- `No non-Parameters datasource found.`
:::

#### Example

`"Sample - Superstore"`

<hr />

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected).

#### Example

`"studio-1"`

## Notes and caveats

- **Where the set is inserted.** The set is appended at the end of the chosen datasource's definition, never into the `Parameters` datasource and never inside a `<relation>` block — the position at which %product_name% reliably accepts the addition.
- **Readback verification.** After the apply, the tool re-reads the workbook and confirms the new set's name and caption are present, and that %product_name% kept it marked as a set rather than a plain group. If the load completed at the transport level but that is not what comes back, the tool reports that the change did not apply rather than a success message.

## Example results

### Param-linked Top-N set (`count: "[Parameters].[Parameter 3]"`, `end: "top"`)

```json
{
  "setName": "[Top N Sub-Category Set]",
  "caption": "Top N Sub-Category Set",
  "datasource": "Sample - Superstore",
  "hint": "reference it by caption in a build-worksheets-from-templates fieldMapping, or as a filter/color field"
}
```

### Fixed-N Bottom set (`count: "3"`, `end: "bottom"`)

```json
{
  "setName": "[Bottom 3]",
  "caption": "Bottom 3",
  "datasource": "Sample - Superstore",
  "hint": "reference it by caption in a build-worksheets-from-templates fieldMapping, or as a filter/color field"
}
```

### Empty set (`mode: "empty"`)

```json
{
  "setName": "[Watchlist]",
  "caption": "Watchlist",
  "datasource": "Sample - Superstore",
  "hint": "reference it by caption in a build-worksheets-from-templates fieldMapping, or as a filter/color field"
}
```

### Condition set (`mode: "condition"`)

```json
{
  "setName": "[High Sales Cities]",
  "caption": "High Sales Cities",
  "datasource": "Sample - Superstore",
  "hint": "reference it by caption in a build-worksheets-from-templates fieldMapping, or as a filter/color field"
}
```

## Related

- [`author-action`](author-action.md) — wires a mark interaction to a set, which is how an `empty` set gets its members.
- `get-xml` — reads the structure of the open workbook, including its datasources.
- [`apply-workbook`](../workbook/apply-workbook.md) — applies an edited whole-workbook document back to %product_name%.
