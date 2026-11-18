## Response behavior

The tool returns one of two result shapes:

- **`MCP_S3_BUCKET` unset (default):** returns the CSV as a single JSON-encoded text string
  (`JSON.stringify(csv)`), with newlines escaped as `\n`.
- **`MCP_S3_BUCKET` set:** returns a `resource_link` with a short-lived presigned URL to the CSV
  file in S3, instead of inlining the data.

## Example result (default)

```
"Country/Region,State/Province,Profit Ratio,Latitude (generated),Longitude (generated)\nCanada,Ontario,26.8%,50.94,-84.75\n"
```

## Example result (S3 mode)

```json
{
  "type": "resource_link",
  "uri": "https://example-bucket.s3.amazonaws.com/...presigned...",
  "name": "view-data.csv",
  "mimeType": "text/csv",
  "description": "View data (CSV) stored in S3. This is a short-lived presigned URL."
}
```
