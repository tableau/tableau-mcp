---
sidebar_position: 4
---

# Publish Datasource

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Publishes a TDS or TDSX data source from a staged upload id, or from a local file path when the MCP server runs over stdio, to the specified Tableau project. Use list-projects to discover project IDs. The data source is uploaded and then validated by Tableau as part of publishing.

## APIs called

Talks to Tableau Cloud or Tableau Server.

- Publishes a TDS or TDSX data source from a staged upload id, or from a local file path when the MCP server runs over stdio, to the specified Tableau project.

## Required arguments

### `name`

The name to give the published data source.

### `projectId`

The Tableau project LUID to publish the data source into. Use list-projects to discover available project IDs.

## Optional arguments

### `datasourceUploadId`

Staged data source upload id returned by request-datasource-upload. Use this for hosted clients that cannot pass a local path. The upload id will be deleted upon successful publish (_available November 2026 and later_).

:::note
Provide either datasourceFilePath or datasourceUploadId, not both. Either datasourceFilePath or datasourceUploadId must be provided. For local stdio MCP servers, pass datasourceFilePath. For hosted clients, call [request-datasource-upload](request-datasource-upload.md) first and pass datasourceUploadId.

datasourceFilePath is only supported when the MCP server runs over stdio. On an HTTP server, stage the file with [request-datasource-upload](request-datasource-upload.md) and pass datasourceUploadId; that requires the server to set [`MCP_S3_BUCKET`](../../configuration/mcp-config/env-vars.md#mcp_s3_bucket). datasourceFilePath is only supported when staged S3 uploads are not configured. Call [request-datasource-upload](request-datasource-upload.md) first and pass datasourceUploadId.
:::

### `datasourceFilePath`

Path to a local TDS or TDSX data source file on the MCP server filesystem. Only supported when the MCP server runs over stdio and staged S3 uploads are not configured. On HTTP servers, use datasourceUploadId.

:::note
datasourceFilePath must point to a .tds or .tdsx file. datasourceFilePath must not point to an empty data source file.
:::

### `overwrite`

Whether to overwrite an existing data source with the same name in the target project. Defaults to false.

{/* tool-details */}
## Example

```json
{
  "name": "Sales",
  "projectId": "cbec32db-a4a2-4308-b5f0-4fc67322f359",
  "datasourceFilePath": "/path/to/Sales.tdsx",
  "overwrite": false
}
```

## Result

On success, `status` is `published`, `data` contains the parsed datasource response, and `url` is
the returned `webpageUrl` (or an empty string if Tableau omits it). Tableau validates the datasource
as part of publishing; rejected publications return an error.
{/* /tool-details */}
