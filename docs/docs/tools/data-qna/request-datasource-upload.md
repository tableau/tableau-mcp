---
sidebar_position: 4
---

# Request Data Source Upload

Creates a short-lived staged upload URL for a Tableau TDSX or HYPER data source file. Upload the
file bytes to the returned URL, then call [Publish Data Source](publish-datasource.md) with the
returned `datasourceUploadId`.

This tool exists for hosted MCP clients that cannot pass a local file path on the MCP server's
filesystem — the client uploads the bytes directly to S3 using the presigned URL, and hands Tableau
MCP only the resulting `datasourceUploadId`. Local MCP servers that can read a file path directly
can skip this tool and pass `datasourceFilePath` to [Publish Data Source](publish-datasource.md)
instead.

:::warning[Disabled by Default]
This tool is gated behind the `authoring-tools` feature flag, which defaults to `false` in `features.json`. It is unavailable unless an administrator enables `authoring-tools`. See [Feature Flags](../../developers/feature-flags.md).
Slack clients additionally require the `authoring-with-slack` feature flag.
:::

:::info[Requires S3 configuration]
This tool requires `MCP_S3_BUCKET` (and related S3 settings) to be configured. It returns an error
if staged uploads are not configured, and it is not available when the caller is authenticated via
Passthrough auth.
:::

Related tools: [Publish Data Source](publish-datasource.md)

## Required permissions

- **Site Role**: Requires Creator role or higher

## Required arguments

### `fileName`

The name of the data source file to upload. Must end in `.tdsx` or `.hyper`.

Example: `WAM.tdsx`

## Response behavior

The tool returns a presigned S3 `PUT` URL and an opaque `datasourceUploadId`. Upload the raw file
bytes to `uploadUrl` with the given `requiredHeaders` before `expiresAt`, then pass
`datasourceUploadId` to [Publish Data Source](publish-datasource.md). The upload is not visible to
Tableau until `publish-datasource` is called — this tool only stages the bytes.

Staged uploads are limited to `maxSizeBytes` (5 GB).

## Example result

```json
{
  "datasourceUploadId": "123e4567-e89b-42d3-a456-426614174000",
  "uploadUrl": "https://s3.example.com/signed-put",
  "expiresAt": "2026-10-09T18:05:00.000Z",
  "maxSizeBytes": 5000000000,
  "requiredHeaders": {
    "Content-Type": "application/octet-stream"
  }
}
```
