---
sidebar_position: 4
---

# Publish Data Source

Publishes an existing `.tds` or `.tdsx` directly to Tableau Cloud or Server through the
[Publish Data Source REST API](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#publish_data_source).
The tool uploads the file in chunks, then commits it to the target project. No Studio proxy or
workbook validation endpoint is involved. Preparing or exporting the datasource file is a separate
step; this tool does not embed connection credentials or reconnect a workbook to the published
source.

Requires the `authoring-tools` feature flag. Slack clients also require `authoring-with-slack`. The
minimum site role is Explorer (Can Publish); Tableau publish and overwrite permissions apply. The
MCP scope is `tableau:mcp:datasource:create`; publication uses `tableau:datasources:create` and
`tableau:file_uploads:create`.

## Arguments

- `name`: the published datasource name.
- `projectId`: destination project LUID. Use [List Projects](../projects/list-projects.md) to find
  it.
- Exactly one of `datasourceFilePath` or `datasourceUploadId`. `datasourceUploadId` comes from
  [Request Data Source Upload](request-datasource-upload.md). `datasourceFilePath` is a path on the
  MCP server and is accepted only when `MCP_S3_BUCKET` is unset.
- `overwrite`: defaults to `false`. Set `true` to replace a same-name datasource in the project.

Project bounds apply before file access or upload, including on overwrite. Datasource-ID and tag
bounds constrain queries/listings and do not restrict replacement of a same-name datasource within
an allowed project. Tableau permissions still govern the mutation.

Local files are for trusted clients or a separate server process and filesystem per caller. Shared
HTTP deployments must configure staged S3 uploads so local paths are rejected. Both local and staged
files are limited to **100 MiB (104857600 bytes)**. See
[Publishing bounds and local files](../../configuration/mcp-config/tool-scoping.md#publishing-bounds-and-local-files)
for the trust boundary and memory/concurrency budget. Passthrough sessions do not advertise this
tool when S3 is configured.

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
