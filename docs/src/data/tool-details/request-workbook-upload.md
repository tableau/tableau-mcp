## Response behavior

The tool returns a presigned S3 `PUT` URL and an opaque `workbookUploadId`. Upload the raw workbook
bytes to `uploadUrl` with the given `requiredHeaders` before `expiresAt`, then pass
`workbookUploadId` to [Publish Workbook](publish-workbook.md). The upload is not visible to Tableau
until `publish-workbook` is called — this tool only stages the bytes.

## Worked example

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
