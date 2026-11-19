---
sidebar_position: 9
---

# Open File

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Opens a local file in %product_name% by absolute path: a `.twb`/`.twbx` opens as a workbook, while a datasource file (Excel, `.tds`, extract, and the like) attaches to the open workbook. Opening a workbook while one is already open launches a new window, but this session stays bound to the original — reads keep reporting the first workbook, not the newly opened one.

:::note[Not read-only]
This tool is not read-only and not idempotent. It opens a file in the live %product_name% session, so repeating the call is not a no-op.
:::

## APIs called

This tool acts on the running %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood this is a call to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: the call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface.

- Settles on which %product_name% session to target before anything is sent. Resolved in-process (not an API call).
- Asks %product_name% to open the file at the given absolute path. Requires a connected %product_name% session; authorized by that session's loopback bearer token. The request body is JSON naming `filePath`.
  - `POST /v<x>/app:openFile` — open a local file by absolute path. [API reference](ext://eca/reference/index.html#tag/Application/operation/openFile)

## Required arguments

### `filePath`
Absolute path of the local file to open. Type: string. Must contain at least one character. A `.twb` or `.twbx` opens as a workbook. A datasource file (Excel, text, spatial, extract, `.tds`, and the like) attaches to the workbook already open in the session, and %product_name% creates a workbook first if none is open. A file type %product_name% cannot open is refused before the file is dispatched.

#### Example

```json
{ "filePath": "/Users/me/Sales.twbx" }
```

:::note[New window vs this session]
When `filePath` points at a `.twb` or `.twbx` and a workbook is already open, %product_name% launches that file in a new window. This session stays bound to the original workbook: later reads still describe the first workbook, not the one just opened. Opening a datasource file does not start a new window — it attaches to the workbook this session already has.
:::

## Optional arguments

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected).

#### Example

`"studio-1"`

:::note[Session resolution does not guess]
With no `session` given and no %product_name% instance running, or more than one running, the tool reports an error rather than picking one; the multiple-instance error lists the session IDs to choose from. A `session` that names an instance which is not among the running ones is refused the same way.
:::

## Notes and caveats

- **A request that has been accepted but not finished is reported as such.** When %product_name% answers before the open has settled, the result says the file was requested and is still being applied instead of claiming it completed.

## Example results

### File opened

```json
{ "message": "Opened \"/Users/me/Sales.twbx\"." }
```

### Accepted, still being applied

```json
{ "message": "Requested opening \"/Users/me/Sales.twbx\"; Desktop is still applying it." }
```

## Related

- [`save-workbook`](./save-workbook.md) — saves the session-bound open workbook in place, or a copy to an absolute path.
- `get-sheets` — lists worksheets in the workbook this session is bound to, which remains the original workbook if `open-file` launched a second window.
- `get-xml` — reads the structure of that same session-bound workbook.
