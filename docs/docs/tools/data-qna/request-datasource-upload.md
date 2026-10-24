---
sidebar_position: 5
---

# Request Data Source Upload

Creates a short-lived presigned PUT URL for a `.tds` or `.tdsx` file. Upload the raw bytes using the
returned `requiredHeaders` before `expiresAt`, then pass `datasourceUploadId` to
[Publish Data Source](publish-datasource.md). Requesting a URL does not publish anything to Tableau.

Requires a [blob storage provider](../../configuration/mcp-config/env-vars.md#blob_storage_provider)
and Explorer (Can Publish) or higher. The MCP scope is `tableau:mcp:datasource:create`; requesting a
URL does not call the Tableau REST API.

Use OAuth or server-side authentication. This tool is not available when the caller is authenticated
via Passthrough auth.

## Arguments

- `fileName`: filename ending in `.tds` or `.tdsx`.

## Example result

```json
{
  "datasourceUploadId": "123e4567-e89b-42d3-a456-426614174000",
  "uploadUrl": "https://blob.example.com/signed-put",
  "expiresAt": "2026-10-14T18:05:00.000Z",
  "maxSizeBytes": 5000000000,
  "requiredHeaders": {
    "Content-Type": "application/octet-stream"
  }
}
```

The content type is `application/xml` for TDS and `application/octet-stream` for TDSX. Staged
publishing retains the advertised **5 GB (5000000000 bytes)** limit. The signed URL may not
constrain the PUT size; oversized staged objects are rejected before uploading to Tableau. Configure
staged-file expiry in your blob storage (e.g. S3 lifecycle rules). Publishing streams the file to
Tableau; see
[Data source publishing](../../configuration/mcp-config/tool-scoping.md#data-source-publishing).
