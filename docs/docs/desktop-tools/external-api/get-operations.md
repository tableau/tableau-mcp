---
sidebar_position: 5
---

# Get Operations

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

List in-flight and recent %product_name% operations, or read one of them. Each entry has `id`, `kind`, `state`, timestamps, and, when the operation failed, the error with its `code` and `tableauErrorCode`. The list also includes blocking and progress windows. Reading one operation returns its `kind`, `state`, result or error, warnings, and timestamps. `blockingWindows` and `progressWindows` appear only while that operation is not in a terminal state.

## APIs called

This tool reads operation state from the running %product_name% instance through the local **%product_name% %ecapi_name%**. There are no OAuth scopes.

- With no `operationId`, lists in-flight and recent operations and any blocking or progress windows.
- With `operationId`, reads that one operation.

## Optional arguments

### `session`

Session ID. Optional when a session is pinned or only one %product_name% instance is connected.

#### Example

`"12345"`

<hr />

### `operationId`

Operation id, from the operations list. Omit it to list in-flight and recent operations.

#### Example

`"op-42"`

## Notes and caveats

- **Documents are redacted and may be saved to a file.** With `operationId`, datasource credentials in `result.document` are redacted. When the document is over the inline size cap, it is replaced by `documentFile` (a cache file path) and `documentMessage`. Read that file with [`read-cached-xml`](../cache/read-cached-xml.md), using `startByte` and `endByte` to read a slice.
- **Not read-only.** Writing that cache file is why the tool is not marked read-only.

## Related

- [`get-diagnostics`](./get-diagnostics.md) — reads static diagnostics for the open workbook or a worksheet.
