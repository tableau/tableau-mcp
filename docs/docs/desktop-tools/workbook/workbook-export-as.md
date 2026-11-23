---
sidebar_position: 14
---

# Export Workbook

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Exports the workbook open in %product_name% to a file at `filePath`, leaving the open document unchanged. The write is headless: no Save As dialog appears, and the tool result names the path rather than returning the file's bytes. `format` chooses the output:

- `pdf` — PDF (`.pdf`)
- `powerpoint` — PowerPoint (`.pptx`)
- `packaged-workbook` — packaged workbook (`.twbx`)
- `prior-version` — a down-saved copy for an older release (`.twb` or `.twbx`); also pass `targetVersion`

:::warning[Destructive]
This tool is not read-only. The open workbook is left unchanged, but %product_name% always writes to `filePath` and overwrites any file already there.
:::

## APIs called

This tool acts on the workbook open in the local %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: each call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface. A workbook must be open in the target session.

- Settles on which %product_name% session to target before anything is sent. Resolved in-process (not an API call).
- Exports the open workbook to `filePath` in the requested format. The request body carries `format`, `filePath`, and — when `format` is `prior-version` — `targetVersion`. %product_name% writes the file itself; the open workbook is left as it was. Requires a connected %product_name% session with an open workbook; authorized by that session's loopback bearer token.
  - `POST /v<x>/workbook:exportAs` — export the open workbook to a file. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/exportWorkbook)

## Required arguments

### `format`

Export format. Type: enum. One of `pdf`, `powerpoint`, `packaged-workbook`, or `prior-version`. The extension on `filePath` must match this value:

- `pdf` — `.pdf`
- `powerpoint` — `.pptx`
- `packaged-workbook` — `.twbx`
- `prior-version` — `.twb` or `.twbx`. **Also requires `targetVersion`.** Writes a down-saved copy of the open workbook for the release you name, without changing the workbook that stays open

#### Example

```json
{ "format": "pdf", "filePath": "/Users/me/Book.pdf" }
```

<hr />

### `filePath`
Absolute path for %product_name% to write the export to. Type: string; must be non-empty. The extension must match `format` as listed under [`format`](#format).

The path is forwarded as you give it. %product_name% is the authority on whether the path is an acceptable absolute path and on the extension-to-format match; when either check fails, %product_name% rejects the call and nothing is written. A mismatch is still sent — the refusal comes back from %product_name%, not from a pre-flight check in the tool.

The write overwrites any file already at that path, with no prompt. The tool result reports the path; the exported bytes do not come back in the conversation.

#### Example

```json
{ "format": "powerpoint", "filePath": "/Users/me/Book.pptx" }
```

## Optional arguments

### `targetVersion`
Release to down-save to, as a customer-facing release string such as `"2024.1"`. Type: string; must be non-empty.

**Required when `format` is `prior-version`.** A prior-version call that omits it is refused with `Exporting to a prior version requires targetVersion (e.g. "2024.1").` and never reaches %product_name%.

On every other format the tool drops `targetVersion` before sending the request, so a leftover value is not forwarded.

Whether the string names a known release is validated by %product_name%. An unrecognized value is rejected there, and no file is written.

#### Example

```json
{ "format": "prior-version", "filePath": "/Users/me/Old.twb", "targetVersion": "2024.1" }
```

<hr />

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected).

#### Example

`"12345"`

:::note[Session resolution does not guess]
With no `session` given and no %product_name% instance running, or more than one running, the tool reports an error rather than picking one; the multiple-instance error lists the session IDs to choose from. A `session` that names an instance which is not among the running ones is refused the same way.
:::

## Notes and caveats

- **A request that has been accepted but not finished is reported as such.** When %product_name% answers before the write has settled, the result says the export was requested and is still being applied instead of claiming the file is already written.

## Example results

### Export completed (`format: "pdf"`)

```json
{ "message": "Exported the workbook to \"/Users/me/Book.pdf\"." }
```

### Export completed (`format: "prior-version"`)

```json
{ "message": "Exported the workbook to \"/Users/me/Old.twb\"." }
```

### Accepted, still being applied

```json
{ "message": "Requested exporting the workbook; Desktop is still applying it." }
```

## Related

- [`save-workbook`](./save-workbook.md) — saves the open workbook in place (or Save As to a new path) rather than exporting a separate file.
- [`export-dashboard-image`](../dashboard/export-dashboard-image.md) — renders one dashboard as an image instead of exporting the whole workbook to a file.
- [`export-worksheet-image`](../worksheet/export-worksheet-image.md) — renders one worksheet as an image instead of exporting the whole workbook to a file.
