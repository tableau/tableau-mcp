---
sidebar_position: 4
---

# Publish Data Source

Publishes an existing `.tds` or `.tdsx` directly to Tableau Cloud or Server through the
[Publish Data Source REST API](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#publish_data_source).
The tool uploads the file in chunks, then commits it to the target project. Preparing or exporting
the datasource file is a separate step; this tool does not embed connection credentials or reconnect
a workbook to the published source.

The minimum site role is Explorer (Can Publish); Tableau publish and overwrite permissions apply.
The MCP scope is `tableau:mcp:datasource:create`; publication uses `tableau:datasources:create` and
`tableau:file_uploads:create`.

## Arguments

- `name`: the published datasource name.
- `projectId`: destination project LUID. Use [List Projects](../projects/list-projects.md) to find
  it.
- Exactly one of `datasourceFilePath` or `uploadId`. `uploadId` comes from
  [Request Upload](../workbooks/request-upload.md) and must be a `.tds` or `.tdsx` upload. `datasourceFilePath` is a path on the
  MCP server and is accepted only when the server runs over stdio and no blob storage provider is
  configured.
- `overwrite`: defaults to `false`. Set `true` to replace a same-name datasource in the project.

Project bounds apply before file access or upload, including on overwrite. Datasource-ID and tag
bounds constrain queries/listings and do not restrict replacement of a same-name datasource within
an allowed project. Tableau permissions still govern the mutation.

Local paths are accepted only when the MCP server runs over stdio, and use the server process's
filesystem permissions. Don't put a stdio server behind a stdio-to-HTTP proxy: it still counts as
stdio, so remote callers could read files on the server. HTTP servers must use staged uploads
instead. Staged uploads retain the **5 GB (5000000000 bytes)** limit. Files are streamed to Tableau,
never held in server memory whole. See
[Data source publishing](../../configuration/mcp-config/tool-scoping.md#data-source-publishing) for
the input and project bounds.

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
