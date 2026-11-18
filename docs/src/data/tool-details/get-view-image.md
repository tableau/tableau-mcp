## Response behavior

The tool returns one of two result shapes:

- **`MCP_S3_BUCKET` unset (default):** returns the rendered image inline, base64-encoded.
- **`MCP_S3_BUCKET` set:** returns a `resource_link` with a short-lived presigned URL to the
  rendered image in S3 (with `mimeType` matching `format`), instead of inlining the image data.

## Example result (S3 mode)

```json
{
  "type": "resource_link",
  "uri": "https://example-bucket.s3.amazonaws.com/...presigned...",
  "name": "view-image.png",
  "mimeType": "image/png",
  "description": "Rendered view image stored in S3. This is a short-lived presigned URL."
}
```
