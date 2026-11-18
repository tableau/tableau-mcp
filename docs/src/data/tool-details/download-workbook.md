## Response behavior

The tool returns one of two result shapes:

- **S3 file mode enabled:** returns a `resource_link` with a short-lived presigned URL to the workbook file.
- **S3 file mode disabled or upload failure:** writes the workbook to a local temporary directory and returns a JSON object containing a local file path.

The tool preserves Tableau response metadata when present:

- `mimeType` is typically:
  - `application/xml` for `.twb`
  - `application/octet-stream` for `.twbx`
- `name` (for `resource_link`) and `filename` (for temp-file JSON) are taken from Tableau's `Content-Disposition` filename when available, otherwise a fallback name is generated.

## Example result (S3 mode)

```json
{
  "type": "resource_link",
  "uri": "https://example-bucket.s3.amazonaws.com/...presigned...",
  "name": "Superstore.twbx",
  "mimeType": "application/octet-stream",
  "description": "Downloaded Tableau workbook content stored in S3. This is a short-lived presigned URL."
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
