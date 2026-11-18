---
sidebar_position: 10
---

# Get Datasources

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

List every datasource in the open workbook, or read one of them. The list includes datasources no sheet uses and the Parameters datasource (`type` `parameters`). Each entry has `id`, `name`, `caption`, and `type`. `isExtract` is true for an extract and false for a live connection. The id is percent-encoded: pass it back as-is. `luid` appears only for a published datasource when %product_name% is signed in to its site. `hasDownloadFilePermission` appears for published datasources.

## APIs called

This tool reads the workbook open in the running %product_name% instance through the local **%product_name% %ecapi_name%**. There are no OAuth scopes.

- With no `datasourceId`, lists the workbook's datasources.
- With `datasourceId`, reads that one datasource. A value that is not an id is matched against a unique name or caption.

## Optional arguments

### `session`

Session ID. Optional when a session is pinned or only one %product_name% instance is connected.

#### Example

`"studio-1"`

<hr />

### `datasourceId`

Datasource id as returned by the list (already percent-encoded). A unique name or caption also works. Omit it to list every datasource.

#### Example

`"Sales"`

## Notes and caveats

- Pass the returned `id` back unchanged. It is already percent-encoded. That id is the workbook's own identifier, not the published datasource LUID on Tableau Cloud or Server. `luid` is a separate field and appears only when %product_name% is signed in to the datasource's site.
- Fields the workbook does not report are omitted. `hasDownloadFilePermission` is included only when it is a boolean.
- An empty datasource list on a worksheet, from `get-sheets`, does not mean the workbook has no connected datasource. Use this tool when the connection inventory matters.

## Related

- [`get-sheets`](../worksheet/get-sheets.md) — lists sheets. A worksheet's datasource list is references, not the workbook's connections.
- [`refresh-datasource`](./refresh-datasource.md) — refreshes one datasource's live data or its extract.
