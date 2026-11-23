---
sidebar_position: 5
---

# Request Workbook Upload

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Creates a short-lived staged upload URL for a Tableau TWB or TWBX workbook. PUT exactly `fileSizeBytes` bytes to the returned URL with the returned `requiredHeaders`, then call publish-workbook with the returned workbookUploadId. Each upload id can be published once.

## APIs called

Talks to Tableau Cloud or Tableau Server.

- Creates a short-lived staged upload URL for a Tableau TWB or TWBX workbook.

## Required arguments

### `fileName`

Name of the Tableau workbook file to upload. Must end in .twb or .twbx.

### `fileSizeBytes`

Exact file size in bytes; the upload must send exactly this many bytes (_available November 2026 and later_). Range: 1-5000000000.

{/* tool-details */}
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
{/* /tool-details */}
