---
sidebar_position: 5
---

# Request Data Source Upload

Creates a short-lived presigned S3 PUT URL for a `.tds` or `.tdsx` file. Upload the raw bytes using
the returned `requiredHeaders` before `expiresAt`, then pass `datasourceUploadId` to
[Publish Data Source](publish-datasource.md). Requesting a URL does not publish anything to Tableau.

Requires `MCP_S3_BUCKET`, the `authoring-tools` feature flag, and Explorer (Can Publish) or higher.
Slack clients also require `authoring-with-slack`. The MCP scope is `tableau:mcp:datasource:create`;
requesting a URL does not call the Tableau REST API.

Use OAuth or server-side authentication. Passthrough sessions omit this tool from discovery, and
with S3 configured also omit `publish-datasource`. Calls using a cached upload tool still fail
before issuing a signed URL for Passthrough authentication.

## Arguments

- `fileName`: filename ending in `.tds` or `.tdsx`.

## Example result

```json
{
  "datasourceUploadId": "123e4567-e89b-42d3-a456-426614174000",
  "uploadUrl": "https://s3.example.com/signed-put",
  "expiresAt": "2026-10-14T18:05:00.000Z",
  "maxSizeBytes": 104857600,
  "requiredHeaders": {
    "Content-Type": "application/octet-stream"
  }
}
```

The content type is `application/xml` for TDS and `application/octet-stream` for TDSX. Both staged
and local publishing enforce the advertised **100 MiB** limit. The signed URL does not constrain the
PUT size; oversized staged objects are rejected before uploading to Tableau. Configure S3 lifecycle
rules for staged-file expiry. Publishing buffers the file; see
[Publishing bounds and local files](../../configuration/mcp-config/tool-scoping.md#publishing-bounds-and-local-files)
for memory and concurrency guidance.
