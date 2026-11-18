---
sidebar_position: 5
---

# Refine Worksheet

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Applies one bounded, validated refinement to an existing worksheet without hand-editing whole-workbook XML. It reads the worksheet once, computes the smallest change needed, validates and applies it once, then re-reads the worksheet to confirm the change landed. The `operation` argument selects which refinement to make:

- `top_n` — apply a Top/Bottom-N filter to the worksheet.
- `sort_direction` — flip the direction of the worksheet's existing sort.
- `sort_by_field` — sort a categorical axis by a measure.
- `mark_type` — change the worksheet's mark type.
- `round_bar` — rebuild the worksheet as subtle rounded bars (_available November 2026 and later_).
- `round_stacked_bar` — rebuild the worksheet as subtle rounded stacked bars.

If the request falls outside what this tool supports, it refuses with a precise reason and hands back to the full authoring path (`get-xml` + `apply-worksheet`); it never retries and never applies twice.

:::warning[Destructive]
This tool mutates the named worksheet in the active workbook. It is not read-only and is not idempotent.
:::

## APIs called

This tool acts on the workbook open in the local %product_name% instance, communicating with %product_name% directly rather than calling the Tableau Cloud or Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. These loopback calls carry **no OAuth scopes**; each is authorized by the running %product_name% instance's **per-session bearer token** over the loopback interface. All `operation` variants use the same read → validate → apply → confirm sequence below.

- Reads the target worksheet's XML once. Requires a workbook to be open in the target session, and the given name must resolve to exactly one worksheet.
  - `GET /v<x>/workbook/worksheets` — list worksheets to resolve the name to an id. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/listWorksheets)
  - `GET /v<x>/workbook/worksheets/{id}/document` — read that worksheet's XML. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/getWorksheetDocument)
- Validates the planned change before anything is sent to %product_name% — validated in-process (not an API call). An error-severity issue is a refusal; nothing is applied.
- Applies the change once as a single whole-workbook write: reads the current workbook, splices in the one changed sheet, and posts the whole document back (the %ecapi_name% has no per-sheet apply route).
  - `GET /v<x>/workbook/document` — read the current workbook XML to splice the change into. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)
  - `POST /v<x>/workbook/document` (`Content-Type: application/xml`) — apply the updated workbook XML. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/applyWorkbookDocument)
- Re-reads the worksheet up to 8 times, 250 ms apart, to confirm the change actually took effect.
  - `GET /v<x>/workbook/worksheets` — re-resolve the worksheet id. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/listWorksheets)
  - `GET /v<x>/workbook/worksheets/{id}/document` — re-read the worksheet to confirm. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/getWorksheetDocument)

## Required arguments

### `worksheetName`

The worksheet display name. Must resolve to exactly one worksheet in the open workbook.

#### Example

```json
{ "worksheetName": "Sales by Region" }
```

:::note
A blank or whitespace-only name is refused with `worksheetName is required.`
:::

<hr />

### `operation`

The refinement type — an enum that selects which change is made and which additional argument is required. One of `top_n`, `sort_direction`, `sort_by_field`, `mark_type`, `round_bar`, or `round_stacked_bar`.

#### Example

`"top_n"`

#### `top_n`

Applies a Top/Bottom-N filter to the worksheet. Requires [`topN`](#topn); optionally set its `end` to filter from the bottom. Refuses (for example) when `n` is outside `1`–`50`.

#### `sort_direction`

Flips the direction of the worksheet's existing sort. Requires [`sortDirection`](#sortdirection). Refuses when there is no existing sort on the worksheet to flip.

#### `sort_by_field`

Sorts a categorical axis by a measure. Requires [`sortByField`](#sortbyfield); optionally set [`targetField`](#targetfield) (the axis) and [`direction`](#direction). When `targetField` is omitted, the axis is auto-detected only if the worksheet has exactly one categorical axis.

#### `mark_type`

Changes the worksheet's mark type. Requires [`markType`](#marktype).

#### `round_bar`

Rebuilds the worksheet as subtle rounded bars (_available November 2026 and later_). Requires [`preset`](#preset) `subtle`.

#### `round_stacked_bar`

Rebuilds the worksheet as subtle rounded stacked bars. Requires [`preset`](#preset) `subtle`.

:::note
`markType is required when operation=mark_type.` `topN is required when operation=top_n.`
:::

## Optional arguments

Each operation has a matching argument below (enforced by the tool, not the JSON schema). Arguments that belong to a different operation are ignored.

### `topN`

**Applies to the `top_n` operation.** Top/Bottom N — an object describing the filter:

- `n` — number of members to keep. `Range: 1-50`.
- `end` — `"top"` or `"bottom"`. Optional; defaults to `top`.

#### Example

```json
{ "topN": { "n": 5, "end": "top" } }
```

<hr />

### `sortDirection`

**Applies to the `sort_direction` operation.** An object (numeric `DESC` = largest first):

- `direction` — `"ASC"` or `"DESC"`, applied to the worksheet's existing sort.

#### Example

```json
{ "sortDirection": { "direction": "DESC" } }
```

:::note
Omitting `sortDirection` when `operation` is `sort_direction` is refused with `sortDirection is required when operation=sort_direction.`
:::

<hr />

### `sortByField`

**Applies to the `sort_by_field` operation.** Measure to sort by.

#### Example

`"Sales"`

:::note
Omitting `sortByField` when `operation` is `sort_by_field` is refused with `sortByField is required when operation=sort_by_field.`
:::

<hr />

### `session`

%product_name% session; omit if only one %product_name% instance is connected.

#### Example

`"studio-1"`

<hr />

### `targetField`

Used only when `operation` is `sort_by_field`: the axis to sort. Omit to auto-detect the categorical axis when the worksheet has exactly one.

#### Example

`"Region"`

<hr />

### `direction`

Used only when `operation` is `sort_by_field`: `"asc"` or `"desc"`. Defaults to `asc`; for numeric fields `desc` is largest first.

#### Example

`"desc"`

<hr />

### `markType`

**Applies to the `mark_type` operation.** The mark type to set. One of `automatic`, `bar`, `line`, `area`, `square`, `circle`, `shape`, `text`, `pie`, `gantt_bar`, or `polygon`.

:::note
`markType` is required when `operation` is `mark_type`.
:::

#### Example

`"bar"`

<hr />

### `preset`

**Applies to `round_bar` and `round_stacked_bar`.** The rounded-bar style. The only value is `subtle`.

:::note
`round_bar` and `round_stacked_bar` require `preset` `subtle`; any other value (or omitting it) is refused and no worksheet change is sent.
:::

#### Example

`"subtle"`

## Notes and caveats

- **Refusals are not errors.** When the request is something this tool can't do (for example, no existing sort to flip, no single categorical axis to auto-detect, or the change fails validation), the tool returns `refined: false` with a precise `reason` and applies nothing.
- **No retry.** The change is applied at most once; if it is not confirmed within the re-read attempts, the tool refuses and hands back to the full authoring path (`get-xml` + `apply-worksheet`).
- **Direction mismatch is reported precisely.** For `sort_by_field`, if the sort is applied but %product_name% uses a different direction than requested, the tool refuses with a direction-mismatch reason rather than reporting success.

## Example results

### Refined (`operation: "top_n"`)

```json
{
  "refined": true,
  "operation": "top_n",
  "worksheetName": "Sales by Region",
  "message": "Applied top_n to worksheet \"Sales by Region\" and confirmed the Top-N filter (function=\"end\") on [Region] on readback."
}
```

### Refused (unsupported request)

```json
{
  "refined": false,
  "operation": "sort_direction",
  "worksheetName": "Sales by Region",
  "reason": "no existing sort on the worksheet to flip. ..."
}
```

## Related

- [`sort-worksheet`](sort-worksheet.md) — applies or clears a native field sort without opening the sort dialog.
- `get-xml` — read worksheet structure.
- [`apply-worksheet`](apply-worksheet.md) — apply an edited cached worksheet file for edits outside the refine envelope.
