---
sidebar_position: 13
---

# Save Workbook

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Saves the workbook currently open in %product_name%. Omit `filePath` to write it in place at the path it already has, or pass an absolute `.twb` or `.twbx` path to Save As there; the open workbook then points at that file. A workbook that has never been saved has no path, so omitting `filePath` then opens the Save As dialog and blocks until a person responds — pass `filePath` to save it headlessly.

:::note[Not read-only]
This tool is not read-only, but it is idempotent. It writes the open workbook to disk in the live %product_name% session; repeating the call after a successful save is a no-op.
:::

## APIs called

This tool acts on the workbook open in the running %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: each call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface.

- Settles on which %product_name% session to target before anything is sent. Resolved in-process (not an API call).
- Asks %product_name% to save the open workbook. When `filePath` is omitted the request body is an empty JSON object, which saves in place at the workbook's current path; when `filePath` is supplied the body is `{ "filePath": "..." }`, which saves the workbook as that file and makes it the open document. Requires a connected %product_name% session with an open workbook; authorized by that session's loopback bearer token.
  - `POST /v<x>/workbook:save` — save the open workbook in place, or Save As to `filePath`. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/saveWorkbook)
- After an in-place save that has finished, reads whether the workbook still has unsaved changes. A finished save can still be a no-op — for example when the Save As dialog was dismissed — so the tool confirms the write this way rather than trusting the save status alone. This read is skipped when `filePath` is supplied or the save is still being applied. Requires a connected %product_name% session; authorized by that session's loopback bearer token.
  - `GET /v<x>/workbook` — read the open workbook's metadata, including whether it still has unsaved changes. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbook)

## Optional arguments

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected).

#### Example

`"12345"`

:::note[Session resolution does not guess]
With no `session` given and no %product_name% instance running, or more than one running, the tool reports an error rather than picking one; the multiple-instance error lists the session IDs to choose from. A `session` that names an instance which is not among the running ones is refused the same way.
:::

<hr />

### `filePath`
Absolute path to Save As the open workbook to; the open workbook then points at this file. Type: string. Minimum length: 1. The path must end in `.twb` or `.twbx`; %product_name% writes workbook content as-is without converting, so any other extension is rejected rather than writing a mislabeled file. Omit this argument to save in place at the workbook's current path.

#### Example

`"/Users/me/Copy.twbx"`

:::note[Never-saved workbooks block on Save As]
A workbook that has never been saved has no current path. Omitting `filePath` in that case leaves nowhere to write, so %product_name% opens its native Save As dialog and the call blocks until a person responds. Pass `filePath` to save that workbook headlessly.

If the person dismisses the dialog without choosing a path, %product_name% can still report the save as complete. The tool then reads whether the workbook still has unsaved changes; when it does, the result says the workbook was not saved rather than claiming success.
:::

## Notes and caveats

- **A request that has been accepted but not finished is reported as such.** When %product_name% answers before the save has settled, the result says saving was requested and is still being applied instead of claiming it completed.

## Example results

### Saved in place (`filePath` omitted)

```json
{ "message": "Saved the open workbook." }
```

### Saved as a new file (`filePath` supplied)

```json
{ "message": "Saved the workbook as \"/Users/me/Copy.twbx\"; it is now the open document." }
```

### Accepted, still being applied

```json
{ "message": "Requested saving the workbook; Desktop is still applying it." }
```

### Save As dismissed (unsaved changes remain)

```json
{ "message": "The save did not complete: Desktop reported it finished, but the workbook still has unsaved changes. A Save dialog may have been dismissed. Do not retry without filePath unless the user is at the machine, because a retry reopens a dialog that blocks until a person answers." }
```

## Related

- [`open-file`](./open-file.md) — opens a local workbook or datasource file in %product_name%.
- [`workbook-export-as`](./workbook-export-as.md) — writes a PDF, PowerPoint, packaged, or prior-version copy without changing the open document.
- `undo-redo-workbook` — reverses the most recent change to the open workbook.
