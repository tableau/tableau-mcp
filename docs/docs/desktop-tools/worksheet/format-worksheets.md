---
sidebar_position: 7
---

# Format Worksheets

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Sets mark labels and number formats on worksheets in the workbook open in %product_name%. One call can format up to 12 worksheets, and each entry carries its own list of fields to format, so a set of sheets can be brought to one number-format convention in a single request. Every requested worksheet is read and prepared before the first change is written, and a worksheet that already carries the requested formatting is left untouched.

## APIs called

This tool acts on worksheets in the workbook open in the running %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are **no OAuth scopes**: each call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface. A workbook must be open in the target session.

- Settles on which %product_name% session to target before anything is sent. Resolved in-process (not an %ecapi_name% call).
- Reads the worksheet inventory of the open workbook so each requested name or id can be matched to one worksheet. Requires a connected %product_name% session with an open workbook; authorized by that session's loopback bearer token. When a match refuses, no further calls are made.
  - `GET /v<x>/workbook/worksheets` — list the worksheets in the open workbook. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/listWorksheets)
- Reads each matched worksheet so the requested formatting can be composed against the fields that worksheet actually uses.
  - `GET /v<x>/workbook/worksheets/{id}/document` — read that worksheet's document. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/getWorksheetDocument)
- Composes the label and number formatting and matches each requested field to a field the worksheet uses. Done in-process (not an %ecapi_name% call). Every requested worksheet is prepared this way first, so a request that cannot be satisfied is refused before any worksheet is written.
- Writes each formatted worksheet back, one worksheet at a time. Immediately before each write the worksheet is re-read and compared against what was prepared, so a worksheet that changed in the meantime is not overwritten. Writes are serialized against other sheet edits so the two cannot interleave.
  - `GET /v<x>/workbook/worksheets/{id}/document` — re-read the worksheet to confirm it has not changed since it was prepared. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/getWorksheetDocument)
  - `POST /v<x>/workbook/worksheets/{id}/document` (`Content-Type: application/xml`) — replace that worksheet with the formatted document. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/applyWorksheetDocument)
- Re-reads each written worksheet until the requested formatting is present and no intent-bearing structure of the worksheet was dropped, retrying briefly because the change settles asynchronously.
  - `GET /v<x>/workbook/worksheets/{id}/document` — re-read the applied worksheet to verify the formatting landed. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/getWorksheetDocument)

## Required arguments

### `worksheets`

The worksheets to format, and the formatting to set on each. Type: array of objects. Range: 1-12 entries. Each entry names one worksheet and sets mark labels, number formats, or both on it; the worksheets are formatted in the order given.

#### Example

```json
{
  "worksheets": [
    {
      "name": "Sales by Category",
      "showLabels": true,
      "numberFormats": [
        { "field": "Sales", "kind": "currency", "currencySymbol": "$", "decimals": 1, "displayUnits": "millions" }
      ]
    },
    {
      "name": "Margin by Segment",
      "numberFormats": [{ "field": "Margin", "kind": "percentage", "decimals": 1 }]
    }
  ]
}
```

#### `name`

Name or id of the worksheet to format. Type: string. Range: 1-255 characters after surrounding whitespace is trimmed. The tool matches against the live worksheet inventory: an exact id match wins; otherwise an exact name match. A name that matches more than one worksheet is refused and the tool asks you to pass an id; a name or id that matches nothing is refused with the worksheets that are available.

:::note[Each worksheet may be named once]
Two entries that resolve to the same worksheet are refused with `Worksheet targets must not contain duplicates.`, and nothing is written. The check runs after every name or id has been matched, so naming one worksheet by name in one entry and by id in another is refused too.
:::

#### `showLabels`

Whether mark labels are shown on the worksheet. Type: boolean. Optional. `true` turns labels on, `false` turns them off. Omit it to leave the worksheet's current label setting alone.

:::note[The worksheet needs something to label]
A worksheet with no chart pane to label is refused with `The worksheet has no pane to format.`, and nothing is written.
:::

#### `numberFormats`

Number formats to set on fields of this worksheet. Type: array of objects. Range: 1-12 entries. Optional. Each entry formats one field:

- `field` — the field to format, given as it appears on the worksheet (for example `Sales`). Range: 1-255 characters after trimming. Matched case-insensitively against the fields the worksheet uses, tolerating surrounding brackets; the exact shelf field string is accepted as well
- `kind` — the kind of format. One of `number`, `currency`, or `percentage`
- `decimals` — how many decimal places to show. Integer. Range: 0-2. Defaults to `0`
- `displayUnits` — the scale values are shown in: `none`, `thousands` (K), `millions` (M), or `billions` (B). Defaults to `none`. Not allowed with `kind: "percentage"`
- `currencySymbol` — the currency symbol to show. One of `$`, `€`, `£`, `¥`. Required with `kind: "currency"`, and allowed only there

Where the field is used on the worksheet decides where its format lands: a field used as a mark value is formatted on the marks, a field on Rows or Columns is formatted on its labels, and a field used both ways is formatted in both places.

:::note[Format requests are refused before anything is written]
The tool refuses, without writing to any worksheet, when:

- `kind` is `currency` and no `currencySymbol` is given — `currencySymbol is required for currency formats`
- `currencySymbol` is given for a `number` or `percentage` format — `currencySymbol is only allowed for currency formats`
- `displayUnits` is given for a `percentage` format — `displayUnits is not allowed for percentage formats`
- `field` matches more than one of the fields the worksheet uses — `Field "<field>" matches more than one field used by this worksheet. Use one exact canonical field reference: <candidates>.`
- `field` is not one of the fields the worksheet uses — `Field "<field>" is not used by this worksheet. Available fields: <fields>.` (or `Available fields: none.`)
- `field` is used by the worksheet but neither as a mark value nor on one of its shelves — `Field "<field>" is not used as a mark value or on a worksheet shelf.`
:::

:::note[Every entry must ask for something]
An entry in `worksheets` that sets neither `showLabels` nor `numberFormats` is rejected with `Each worksheet needs showLabels, numberFormats, or both.`
:::

## Optional arguments

### `session`
Identifier of the target %product_name% session; optional if a session is pinned or only one is connected. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected or a session has been pinned).

#### Example

`"12345"`

:::note[Session resolution does not guess]
With no `session` given and no %product_name% instance running, or more than one running, the tool reports an error rather than picking one; the multiple-instance error lists the session IDs to choose from. A `session` that names an instance which is not among the running ones is refused the same way.
:::

## Notes and caveats

- **Not read-only, but idempotent.** The tool changes live worksheets, so it is not a read-only operation; running the same request again is safe. A worksheet that already carries every piece of formatting the request asks for is skipped — it is reported as formatted without being written to.
- **Worksheets are written one at a time, and partial progress is reported.** When a worksheet fails part-way through a multi-worksheet request, the error says how many earlier worksheets may already be updated (for example, `1 earlier worksheet may already be updated.`) rather than leaving you to guess. Re-running the same request then formats only what is left, because the worksheets that already landed are skipped.
- **A worksheet that changes mid-request is not overwritten.** If a worksheet is edited between being prepared and being written, the tool reports that the worksheet `changed while formatting was being applied` — along with the earlier-updates count — instead of overwriting the newer work.
- **Formatting is verified by reading the worksheet back.** After a write is accepted, the tool re-reads the worksheet and checks both that the requested formatting is present and that no intent-bearing structure of the worksheet was lost. When it is not, the tool reports that the formatting `did not survive readback or Tableau dropped worksheet semantics` rather than claiming success.

## Example result

The tool reports one entry per requested worksheet, in the order they were given. A worksheet that was skipped because it already carried the requested formatting is reported the same way as one that was just changed.

```json
{
  "formatted": [
    { "worksheet": "Sales by Category", "verified": true },
    { "worksheet": "Margin by Segment", "verified": true }
  ]
}
```

## Related

- [`sort-worksheet`](sort-worksheet.md) — applies or clears a native field sort on a worksheet, without opening the sort dialog.
- [`refine-worksheet`](refine-worksheet.md) — bounded top-N and computed-sort edits on worksheet structure.
- [`apply-worksheet`](apply-worksheet.md) — replaces a worksheet with authored content when the change is more than labels and number formats.
- `get-sheets` — lists worksheet names and ids in the open workbook so each `name` you pass resolves to one worksheet.
- [`format-dashboard-zones`](../dashboard/format-dashboard-zones.md) — the dashboard-side counterpart, for formatting zones rather than worksheet marks and labels.
