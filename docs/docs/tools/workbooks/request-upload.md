---
sidebar_position: 4
---

# Request Upload

Creates a short-lived presigned `PUT` URL for a Tableau file (`.twb`, `.twbx`, `.tds`, or `.tdsx`).
Upload the raw bytes using the returned `requiredHeaders` before `expiresAt`, then pass `uploadId` to
the matching publish tool: [Publish Workbook](publish-workbook.md) for `.twb`/`.twbx` or
[Publish Data Source](../data-qna/publish-datasource.md) for `.tds`/`.tdsx`. Requesting a URL does
not publish anything to Tableau.

This tool exists for hosted MCP clients that cannot pass a local file path on the MCP server's
filesystem. Local MCP servers that can read a file path directly can skip it and pass
`workbookFilePath` or `datasourceFilePath` to the publish tool instead.

:::info[Requires blob storage configuration]
This tool requires a
[blob storage provider](../../configuration/mcp-config/env-vars.md#blob_storage_provider) to be
configured. It returns an error if staged uploads are not configured, and it is not available when
the caller is authenticated via Passthrough auth.
:::

Related tools: [Publish Workbook](publish-workbook.md),
[Publish Data Source](../data-qna/publish-datasource.md)

## Required permissions

- **Site Role**: Requires Explorer (Can Publish) role or higher
- **MCP scope**: Any one of `tableau:mcp:workbook:create` or `tableau:mcp:datasource:create`. No
  Tableau REST API scopes are required.

## Required arguments

### `fileName`

The name of the file to upload. Must end in `.twb`, `.twbx`, `.tds`, or `.tdsx`; other extensions are
rejected.

Example: `Superstore.twbx`

## Response behavior

The tool returns a presigned `PUT` URL and an opaque `uploadId`. A publish tool rejects an `uploadId`
whose file type it does not accept (for example, passing a `.tdsx` upload to Publish Workbook). Each
upload is limited to 5 GB (`maxSizeBytes`).

## Example result

```json
{
  "uploadId": "123e4567-e89b-42d3-a456-426614174000",
  "uploadUrl": "https://blob.example.com/signed-put",
  "expiresAt": "2026-08-12T18:05:00.000Z",
  "maxSizeBytes": 5000000000,
  "requiredHeaders": {
    "Content-Type": "application/octet-stream"
  }
}
```
