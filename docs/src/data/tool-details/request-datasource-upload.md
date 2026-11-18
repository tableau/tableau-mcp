## Worked example

```json
{
  "datasourceUploadId": "123e4567-e89b-42d3-a456-426614174000",
  "uploadUrl": "https://s3.example.com/signed-put",
  "expiresAt": "2026-10-14T18:05:00.000Z",
  "maxSizeBytes": 5000000000,
  "requiredHeaders": {
    "Content-Type": "application/octet-stream"
  }
}
```

The content type is `application/xml` for TDS and `application/octet-stream` for TDSX. Staged
publishing retains the advertised **5 GB (5000000000 bytes)** limit. The signed URL does not
constrain the PUT size; oversized staged objects are rejected before uploading to Tableau. Configure
S3 lifecycle rules for staged-file expiry. Publishing buffers the file in server memory.
