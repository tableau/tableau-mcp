---
sidebar_position: 5
---

# Request Datasource Upload

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Creates a short-lived staged upload URL for a Tableau TDS or TDSX data source. PUT exactly `fileSizeBytes` bytes to the returned URL with the returned `requiredHeaders`, then call publish-datasource with the returned datasourceUploadId. Each upload id can be published once.

## APIs called

Talks to Tableau Cloud or Tableau Server.

- Creates a short-lived staged upload URL for a Tableau TDS or TDSX data source.

## Required arguments

### `fileName`

Name of the Tableau data source file to upload. Must end in .tds or .tdsx.

### `fileSizeBytes`

Exact file size in bytes; the upload must send exactly this many bytes (_available November 2026 and later_). Range: 1-5000000000.

{/* tool-details */}
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
{/* /tool-details */}
