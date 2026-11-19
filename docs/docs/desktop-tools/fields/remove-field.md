---
sidebar_position: 5
---

# Remove Field

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Removes a field from a worksheet's Rows shelf, Columns shelf, or an encoding channel by editing the worksheet's cached XML file on the local filesystem. It is the counterpart to the add-field tool. The edit is written back to the same cache file — nothing changes in the open %product_name% workbook until you apply that file with [`apply-worksheet`](../worksheet/apply-worksheet.md).

Name the sheet to edit in one of two ways:

- `worksheetName` — edit the open edit buffer for that sheet. The sheet is fetched from the running %product_name% instance into a new cache file only when no buffer is open yet.
- `worksheetFile` — edit a cache file a previous call produced, so several edits stack up in one file.

At least one is required — supplying neither is refused. If both are supplied, `worksheetFile` is edited, but `worksheetName` is still resolved through `GET /v<x>/workbook/worksheets` and must match a worksheet.

The `target` argument selects where the field is removed from:

- `rows` — remove the field from the Rows shelf.
- `cols` — remove the field from the Columns shelf.
- `encoding` — remove the field from an encoding channel (requires `encodingType`).

:::note[Not read-only]
Although this tool only edits a local cache file, it is not marked read-only: it overwrites the worksheet cache file in place. When it fetches a sheet fresh, it also writes a small companion file recording which %product_name% session produced that cache file.
:::

## APIs called

This tool edits a cached worksheet XML file on the local filesystem, and never sends the edit anywhere: it does **not** call the Tableau Cloud or Server REST API, and it does not write to the open %product_name% workbook. The edited file reaches %product_name% only later, when you pass it to [`apply-worksheet`](../worksheet/apply-worksheet.md). It does read from the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version — whenever you name the sheet with `worksheetName`: to resolve the name, and to fetch the sheet when no edit buffer is open. Those reads carry no OAuth scopes; they are authorized by that %product_name% session's per-session bearer token over the loopback interface. A call that passes only `worksheetFile` issues no %ecapi_name% request at all.

- Resolves and confirms the target %product_name% session from the local instance-discovery files. Local filesystem; no %ecapi_name% call. A requested `session` that is not among the running instances is refused before anything is fetched or written.
- When `worksheetName` is given, resolves it to a worksheet id, even alongside `worksheetFile`.
  - `GET /v<x>/workbook/worksheets` — find the worksheet whose name or id matches. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/listWorksheets)
- When `worksheetName` is given without `worksheetFile` and no edit buffer is open for that sheet, fetches the worksheet and writes it to a **new** cache file, alongside a small companion file recording which session produced it.
  - `GET /v<x>/workbook/worksheets/{id}/document` — read that worksheet's XML. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/getWorksheetDocument)
  - Local filesystem; no %ecapi_name% call — writes the new cache file and its session companion file.
- Reads the cached worksheet XML from the local filesystem, then removes the field in-process and validates that the result is well-formed XML. Local filesystem read plus in-process editing and validation; no %ecapi_name% call.
- Writes the modified worksheet XML back to the same cache file. Local filesystem; no %ecapi_name% call.

## Required arguments

### `target`

Where the field is removed from. One of:

- `rows` — the Rows shelf.
- `cols` — the Columns shelf.
- `encoding` — an encoding channel named by `encodingType`.

#### Example

`"rows"`

<hr />

### `columnRef`

The field reference to remove, as it appears in the worksheet XML (a fully-qualified column reference).

#### Example

`"[Sample - Superstore].[sum:Profit:qk]"`

## Optional arguments

`worksheetName` and `worksheetFile` are both optional in the schema, but naming the sheet is not: the tool — not the schema — refuses a call that supplies neither, with `Provide either worksheetName (to edit an existing sheet) or worksheetFile (a cached path).`

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected). If a value is given, it must correspond to a running %product_name% instance or the call is refused with a session-mismatch error before the file is written.

#### Example

`"12345"`

<hr />

### `worksheetName`

Display name (or id) of a worksheet in the open %product_name% workbook. Name-only calls continue the open edit buffer for that sheet: the tool fetches that sheet fresh from the running instance and writes it to a **new** cache file only when no buffer is already open, then removes the field from that copy. The minted path comes back in the result — pass it as `worksheetFile` on follow-up edits so they stack in one file instead of each starting from a fresh copy. A name that matches no worksheet, or more than one, is refused with an error that lists the sheets available.

:::note[Both selectors]
If `worksheetFile` is supplied and is not blank, that file is edited and no sheet is fetched. `worksheetName` is still resolved against the live worksheet list, and a name that matches no worksheet is refused even though the file would be edited.
:::

#### Example

`"Sales by Region"`

<hr />

### `worksheetFile`
Filesystem path to an existing cached worksheet XML file to force as the edit target. Omit it to continue the open edit buffer. Get this path from `get-xml`, or from the result of an earlier `remove-field` / add-field call, so successive edits accumulate in one file. When supplied, the path must exist — a missing file is reported as a file-not-found error, not fetched fresh. After this tool rewrites the file in place, apply it with [`apply-worksheet`](../worksheet/apply-worksheet.md).

#### Example

`"/Users/me/.tableau-mcp/cache/worksheet-Sales_by_Region-abc123.xml"`

<hr />

### `encodingType`
Which encoding channel to remove the field from. One of `color`, `size`, `lod`, `detail`, `text`, `tooltip`, `path`, or `angle`. **Required when `target` is `encoding`.** Ignored when `target` is `rows` or `cols`.

#### Example

`"color"`

:::note
When `target` is `encoding` and `encodingType` is omitted, the tool refuses: encodingType is required when target=encoding. Provide one of: color, size, lod, detail, text, tooltip, path, angle.
:::

## Example result

```json
{
  "message": "Successfully removed field from Rows shelf. Removal is complete in this draft; other placements are unchanged. Updated file: /Users/me/.tableau-mcp/cache/worksheet-Sales_by_Region-abc123.xml. These draft edits have not been applied. Current placements are included below (encodings cover the first pane). If further verification is needed, use read-cached-xml with filePath set to this file. Do not use get-xml to verify pending edits; it reads live state and resets the edit buffer. Use apply-worksheet with this file to apply changes.",
  "file": "/Users/me/.tableau-mcp/cache/worksheet-Sales_by_Region-abc123.xml",
  "applied": false,
  "removed": {
    "columnRef": "[Sample - Superstore].[sum:Profit:qk]",
    "placement": "Rows shelf"
  },
  "currentPlacements": {
    "rows": ["[Sample - Superstore].[sum:Sales:qk]"],
    "cols": ["[Sample - Superstore].[none:Region:nk]"],
    "encodings": { "color": ["[Sample - Superstore].[none:Category:nk]"] }
  }
}
```

When the field is removed from `detail` or `lod`, the message says `Detail (lod) encoding`, adds `Detail and lod are aliases for the same encoding. Do not repeat this removal using the other alias.`, and `removed.placement` is `lod encoding`.

`file` is the cache file that now holds the edit: the same path you passed as `worksheetFile`, or — when the sheet was named with `worksheetName` — the path of the open edit buffer or the newly minted file. Either way it is the value to pass as `worksheetFile` on the next edit, and to [`apply-worksheet`](../worksheet/apply-worksheet.md) when the sheet is ready.

## Related

- `get-xml` — reads worksheet structure and produces the cache file this tool edits.
- [`apply-worksheet`](../worksheet/apply-worksheet.md) — applies the edited cache file back to the open %product_name% workbook.
