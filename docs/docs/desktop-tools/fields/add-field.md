---
sidebar_position: 2
---

# Add Field

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Places a field on a worksheet shelf in the open %product_name% workbook — the manual path for adding a field when no template binding applies. The `target` argument selects the shelf or encoding channel:

- `rows` — add the field to the Rows shelf
- `cols` — add the field to the Columns shelf
- `encoding` — add the field to an encoding channel (color, size, detail, and so on); requires `encodingType`

This tool edits a cached copy of the worksheet on the local filesystem and does not apply the change to the open workbook; run [`apply-worksheet`](../worksheet/apply-worksheet.md) to write the edit back.

:::note[Not read-only]
Although this is a single edit step, it is not read-only: it writes the modified worksheet XML to a local cache file (plus, when it reads from the open workbook, a small companion file recording which %product_name% session produced it). Chain multiple `add-field` edits on the same cache file, then apply them once with [`apply-worksheet`](../worksheet/apply-worksheet.md).
:::

## APIs called

This tool acts on the worksheet in the open %product_name% workbook, communicating with %product_name% directly rather than calling the Tableau Cloud or Server REST API. Under the hood any calls are to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. These loopback calls carry **no OAuth scopes**; each is authorized by the running %product_name% instance's **per-session bearer token** over the loopback interface. The field edit itself is performed in-process on a local cache file, so the %ecapi_name% is reached only to resolve a `worksheetName`, to fetch a sheet that has no open edit buffer, and to read the live workbook when `workbookFile` is omitted.

- Resolves `worksheetName` to a worksheet id — whenever `worksheetName` is given. Requires a workbook to be open in the target session, and the name must resolve to exactly one worksheet.
  - `GET /v<x>/workbook/worksheets` — list worksheets to resolve the name to an id. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/listWorksheets)
- Fetches the named worksheet from the open workbook and mints a local cache file for it — only when `worksheetName` is given without a `worksheetFile` and the sheet has no open edit buffer.
  - `GET /v<x>/workbook/worksheets/{id}/document` — read that worksheet's XML. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/getWorksheetDocument)
- Reads the live workbook — only when `workbookFile` is omitted.
  - `GET /v<x>/workbook/document` — read the current workbook XML. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)
- Places the field on the chosen shelf or encoding, checks the result, and saves it — no %ecapi_name% call.
  - Field placement and well-formed-XML validation run in-process (not an API call).
  - Reading the cached worksheet file (and an optional workbook file) and writing the edited XML back — plus a companion file recording the %product_name% session — are local filesystem operations (no API call).

## Required arguments

### `target`
The shelf or encoding channel to place the field on. One of `rows`, `cols`, or `encoding`.

- `rows` — the Rows shelf
- `cols` — the Columns shelf
- `encoding` — an encoding channel selected by `encodingType`

When `target` is `encoding`, `encodingType` is required.

#### Example

```json
{ "target": "cols" }
```

<hr />

### `columnRef`
Reference to the field to add, as a datasource-qualified column reference in the form `[Datasource].[derivation:Column:type]`.

#### Example

```json
{ "columnRef": "[Sample - Superstore].[sum:Profit:qk]" }
```

## Optional arguments

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected).

#### Example

`"12345"`

<hr />

### `worksheetName`
Display name of the worksheet to edit. Name-only calls reuse the open edit buffer for that sheet; omit this argument to pass `worksheetFile` instead. Provide either `worksheetName` or `worksheetFile`.

#### Cached on first use

When you pass `worksheetName` without a `worksheetFile`, the tool reads the sheet from the open workbook (see [APIs called](#apis-called)) and writes it to a new cache file before editing. The result includes that file path, so you can stack more edits by passing it as `worksheetFile` on follow-up calls before a single [`apply-worksheet`](../worksheet/apply-worksheet.md). If both `worksheetName` and `worksheetFile` are given, `worksheetFile` wins and the sheet is not fetched, though `worksheetName` must still resolve to a worksheet.

#### Example

`"Sheet 1"`

:::note
Passing neither `worksheetName` nor `worksheetFile` is refused with `Provide either worksheetName (to edit an existing sheet) or worksheetFile (a cached path).`
:::

<hr />

### `worksheetFile`
Filesystem path to a cached worksheet XML file from a prior edit or from `get-xml`. Omit it to reuse the open edit buffer. When supplied, edits accumulate on this file, so passing it lets you stack multiple field edits before applying. Provide either `worksheetName` or `worksheetFile`.

#### Example

`"/Users/me/.tableau-mcp/cache/worksheet-Sheet_1-abc123.xml"`

<hr />

### `encodingType`
Which encoding channel to place the field on: one of `color`, `size`, `lod`, `detail`, `text`, `tooltip`, `path`, or `angle`. **Required when `target` is `encoding`**; ignored for `rows` and `cols`.

#### Example

`"color"`

:::note
When `target` is `encoding` and `encodingType` is omitted, the tool refuses with `encodingType is required when target=encoding. Provide one of: color, size, lod, detail, text, tooltip, path, angle.`
:::

<hr />

### `index`
Optional position at which to insert the field within the target shelf or encoding. When omitted, the field is appended.

#### Example

`2`

:::note
`index` must be an integer in the range `0` through the number of fields already on that shelf or encoding, inclusive. Anything else is refused with `index must be an integer in the range 0..<count> for <target>.`
:::

<hr />

### `workbookFile`
Optional filesystem path to a cached workbook XML file returned by field resolution. When omitted, the tool reads the workbook live. If the file is missing or unreadable, the call fails and nothing is edited.

#### Example

`"/Users/me/.tableau-mcp/cache/workbook-abc123.xml"`

## Example result

```json
{
  "message": "Successfully added field to Columns shelf. Updated file: /Users/me/.tableau-mcp/cache/worksheet-Sheet_1-abc123.xml. Use apply-worksheet with this file to apply changes.",
  "file": "/Users/me/.tableau-mcp/cache/worksheet-Sheet_1-abc123.xml"
}
```

## Related

- [`apply-worksheet`](../worksheet/apply-worksheet.md) — applies the edited cache file back to the open %product_name% workbook.
- `get-xml` — reads worksheet structure and produces a cache file to edit.
