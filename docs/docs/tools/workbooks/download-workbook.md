---
sidebar_position: 3
---

# Download Workbook

Downloads workbook content from Tableau as either an unpackaged TWB XML file or a packaged TWBX file.

## Required permissions

- **Site Role**: Requires Explorer role or higher

## APIs called

- [Download Workbook](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#download_workbook)
- [Query Workbook](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#query_workbook)
  (if applicable [tool scoping](../../configuration/mcp-config/tool-scoping.md) is enabled)

## Required arguments

### `workbookId`

The ID of the workbook to download, potentially retrieved by the
[List Workbooks](list-workbooks.md) tool.

Example: `222ea993-9391-4910-a167-56b3d19b4e3b`

## Optional arguments

### `includeExtract`

Whether to include workbook extracts in the returned package when available.

Example: `true`

## Response behavior

The tool returns one of two result shapes:

- **Blob storage mode enabled:** returns a `resource_link` with a URL to the workbook file in blob storage.
- **Blob storage mode disabled, or the upload fails before reading any bytes:** writes the workbook to a local temporary directory and returns a JSON object containing a local file path. An upload that fails mid-stream returns an error, since the download can't be replayed.

The workbook is streamed end to end (never held in memory whole) and is capped at 5 GB; larger workbooks return an error.

The tool preserves Tableau response metadata when present:

- `mimeType` is typically:
  - `application/xml` for `.twb`
  - `application/octet-stream` for `.twbx`
- `name` (for `resource_link`) and `filename` (for temp-file JSON) are taken from Tableau's `Content-Disposition` filename when available, otherwise a fallback name is generated.

## Example result (blob storage mode)

```json
{
  "type": "resource_link",
  "uri": "https://blob.example.com/...presigned...",
  "name": "Superstore.twbx",
  "mimeType": "application/octet-stream",
  "description": "Downloaded Tableau workbook content stored in blob storage."
}
```

## Example result (temp-file fallback)

```json
{
  "path": "/var/folders/.../tableau-mcp-workbooks/0c831313-bf52-4eb8-b087-8f4d37b6cb49-Superstore.twbx",
  "filename": "Superstore.twbx",
  "mimeType": "application/octet-stream"
}
```
