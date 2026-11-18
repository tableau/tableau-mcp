---
sidebar_position: 3
---

# Sort Worksheet

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Applies or clears a sort on a field of a worksheet in the workbook open in %product_name%, without opening the sort dialog. Pass the field as it appears on the worksheet (for example `Sales`). Set `clearSort` to `true` to remove the sort on that field instead of applying one.

## APIs called

This tool acts on a worksheet in the workbook open in the running %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: each call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface. A workbook must be open in the target session.

- Settles on which %product_name% session to target before anything is sent. Resolved in-process (not an API call).
- Reads the worksheet inventory of the open workbook so the requested name or id can be matched to one worksheet. Requires a connected %product_name% session with an open workbook; authorized by that session's loopback bearer token. When that match refuses, no further calls are made.
  - `GET /v<x>/workbook/worksheets` — list the worksheets in the open workbook. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/listWorksheets)
- Reads the matched worksheet so the requested field can be matched to one already on its shelves.
  - `GET /v<x>/workbook/worksheets/{id}/document` — read that worksheet's document. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/getWorksheetDocument)
- Matches the requested field to a field on the worksheet's shelves. Validated in-process (not an API call). When that check refuses, nothing is posted.
- Asks %product_name% to apply or clear the sort on that field. Issued only after the field match succeeds. Requires a connected %product_name% session; authorized by that session's loopback bearer token. The JSON body carries the matched shelf field plus any `direction`, `sortType`, and `clearSort` you supplied.
  - `POST /v<x>/workbook/worksheets/{id}:sort` (`Content-Type: application/json`) — apply or clear the sort on the resolved field. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/sortWorksheet)

## Required arguments

### `worksheet`

Name or id of the worksheet to sort. Type: string. The tool matches against the live worksheet inventory after trimming whitespace: an exact id match wins; otherwise an exact, case-sensitive name match. A name that matches more than one worksheet is refused, and the tool asks you to pass an id. A name or id that matches nothing is refused with the worksheets that are available.

#### Example

```json
{ "worksheet": "Sales by Region" }
```

:::note
`fieldName` is checked against this worksheet's shelves before a request is sent.

- A name that matches more than one shelf field is refused with `Field "<field>" is ambiguous on worksheet "<worksheet>"'s shelves. Matching canonical fields: <fields>. Use one of those exact tokens. sort-worksheet did not send a request.`
- A field that is on the shelf but whose type cannot be verified is refused with `Field "<field>" is on the worksheet shelf, but its field type could not be verified. sort-worksheet did not send a request.`
- A quantitative or continuous shelf field is refused with `Field "<field>" resolves to a quantitative/continuous shelf field, but sort-worksheet only orders members of a discrete shelf field. To rank a dimension by a measure, use refine-worksheet with operation sort_by_field.` Use [`refine-worksheet`](refine-worksheet.md) for that ranking.
- `Field "${}" is ambiguous on worksheet "${}"'s shelves. Matching canonical fields: ${}. Use one of those exact tokens. sort-worksheet did not send a request.`
- `Field "${}" is on the worksheet shelf, but its field type could not be verified. sort-worksheet did not send a request.`
- `Field "${}" resolves to a quantitative/continuous shelf field, but sort-worksheet only orders members of a discrete shelf field. To rank a dimension by a measure, use refine-worksheet with operation sort_by_field.`
:::

<hr />

### `fieldName`
Field to sort by, given as the worksheet field name (for example `Sales`). Type: string. Range: 1 and above.

#### Shelf match

The field must already be on the worksheet's shelves (Rows, Columns, or Marks). The tool matches a plain name case-insensitively and tolerates surrounding brackets; you can also pass the exact shelf field string if you have it. The result's `fieldName` is that matched shelf field, not necessarily the caption you passed.

:::note[Field must be on the shelves]
A field that is not on the worksheet's shelves is refused before anything is sent to %product_name%, and the error lists the fields that are. Nothing is sorted.
:::

#### Example

```json
{ "fieldName": "Sales" }
```

## Optional arguments

### `direction`

Sort direction. One of:

- `asc` — ascending
- `desc` — descending (for numeric fields, largest first)

Defaults to `asc` when omitted.

#### Example

`"desc"`

<hr />

### `sortType`
How the field's values are ordered. One of:

- `data-source-order` — data source order
- `alpha` — alphabetical

Defaults to `data-source-order` when omitted.

#### Example

`"alpha"`

<hr />

### `clearSort`
When `true`, clears the sort on the field instead of applying one. Omit it to apply a sort.

#### Example

`true`

<hr />

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected or a session has been pinned).

#### Example

`"studio-1"`

:::note[Session resolution does not guess]
With no `session` given and no %product_name% instance running, or more than one running, the tool reports an error rather than picking one; the multiple-instance error lists the session IDs to choose from. A `session` that names an instance which is not among the running ones is refused the same way.
:::

## Notes and caveats

- **Not read-only, but idempotent.** The tool changes the sort on a live worksheet, so it is not a read-only operation; applying the same sort again, or clearing a field that is already unsorted, is safe to repeat.
- **A request that has been accepted but not finished is reported as such.** When %product_name% answers before the change has settled, the result says a sort was requested and is still being applied instead of claiming it completed.

## Example results

### Sort applied

```json
{
  "worksheet": { "id": "sheet-sales", "name": "Sales by Region" },
  "fieldName": "[Sample - Superstore].[sum:Sales:qk]",
  "message": "Sorted worksheet \"Sales by Region\" by \"[Sample - Superstore].[sum:Sales:qk]\"."
}
```

### Sort cleared (`clearSort: true`)

```json
{
  "worksheet": { "id": "sheet-sales", "name": "Sales by Region" },
  "fieldName": "[Sample - Superstore].[sum:Sales:qk]",
  "message": "Cleared the sort on \"[Sample - Superstore].[sum:Sales:qk]\" in worksheet \"Sales by Region\"."
}
```

### Accepted, still being applied

```json
{
  "worksheet": { "id": "sheet-sales", "name": "Sales by Region" },
  "fieldName": "[Sample - Superstore].[sum:Sales:qk]",
  "message": "Requested sort on worksheet \"Sales by Region\"; Desktop is still applying it."
}
```

## Related

- [`apply-worksheet`](apply-worksheet.md) — replace a worksheet with authored content when the change is more than a field sort.
- [`refine-worksheet`](refine-worksheet.md) — bounded top-N and computed-sort edits on worksheet structure, without the native sort command this tool issues.
- `get-sheets` — lists worksheet names and ids in the open workbook so you can pass a unique `worksheet`.
