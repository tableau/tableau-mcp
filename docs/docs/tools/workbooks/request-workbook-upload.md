---
sidebar_position: 4
---

# Request Workbook Upload

Creates a short-lived staged upload URL for a Tableau TWB or TWBX workbook. Upload the workbook
bytes to the returned URL, then call [Publish Workbook](publish-workbook.md) with the returned
`workbookUploadId`.

This tool exists for hosted MCP clients that cannot pass a local file path on the MCP server's
filesystem — the client uploads workbook bytes directly to S3 using the presigned URL, and hands
Tableau MCP only the resulting `workbookUploadId`. Local MCP servers that can read a file path
directly can skip this tool and pass `workbookFilePath` to [Publish Workbook](publish-workbook.md)
instead.

:::warning[Disabled by Default]
This tool is gated behind the `authoring-tools` feature flag, which defaults to `false` in `features.json`. It is unavailable unless an administrator enables `authoring-tools`. See [Feature Flags](../../developers/feature-flags.md).
:::

:::info[Requires S3 configuration]
This tool requires `MCP_S3_BUCKET` (and related S3 settings) to be configured. It returns an error
if staged uploads are not configured, and it is not available when the caller is authenticated via
Passthrough auth.
:::

Related tools: [Publish Workbook](publish-workbook.md)

## Required arguments

### `fileName`

The name of the Tableau workbook file to upload. Must end in `.twb` or `.twbx`.

Example: `Superstore.twbx`

## Response behavior

The tool returns a presigned S3 `PUT` URL and an opaque `workbookUploadId`. Upload the raw workbook
bytes to `uploadUrl` with the given `requiredHeaders` before `expiresAt`, then pass
`workbookUploadId` to [Publish Workbook](publish-workbook.md). The upload is not visible to Tableau
until `publish-workbook` is called — this tool only stages the bytes.

## Example result

```json
{
  "workbookUploadId": "123e4567-e89b-42d3-a456-426614174000",
  "uploadUrl": "https://s3.example.com/signed-put",
  "expiresAt": "2026-08-12T18:05:00.000Z",
  "maxSizeBytes": 5000000000,
  "requiredHeaders": {
    "Content-Type": "application/octet-stream"
  }
}
```
