---
sidebar_position: 5
---

# Publish Data Source

Publishes a TDSX or HYPER data source extract to a Tableau project from a staged upload id or a
local file path. Use [List Projects](../projects/list-projects.md) with `capability: "Write"` to
discover the projects you can publish to. Data sources cannot be published to Personal Space.

A bare `.hyper` file must contain exactly one table; Tableau rejects multi-table `.hyper` files.
Package multi-table models (with their relationships) as a `.tdsx`. Live-connection `.tds` files
are not supported, because they would require connection credentials in the publish request.

The file is streamed to Tableau in 64 MB chunks rather than loaded into memory, so large extracts
(up to the 5 GB staging limit) are safe to publish from a shared hosted server.

:::warning[Disabled by Default]

This tool is gated behind the `authoring-tools` feature flag, which
defaults to `false` in `features.json`. It is unavailable unless an administrator enables
`authoring-tools`. See [Feature Flags](../../developers/feature-flags.md).
Slack clients additionally require the `authoring-with-slack` feature flag.

:::

Related tools: [Request Data Source Upload](request-datasource-upload.md),
[List Projects](../projects/list-projects.md), [List Data Sources](list-datasources.md)

## Required permissions

- **Site Role**: Requires Creator role or higher

## APIs called

- [Query Data Sources](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_sources)
  (name collision check before uploading, and LUID lookup after publishing)
- [Initiate/Append File Upload](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_publish.htm)
- [Publish Data Source](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_publishing.htm#publish_data_source)
  (with `asJob=true`)
- [Query Job](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_jobs_tasks_and_schedules.htm#query_job)
- [Query Data Source Permissions](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_permissions.htm#query_data_source_permissions)
  (after a successful publish)

## Required arguments

### `name`

The name to give the published data source. Names containing commas are not supported.

Example: `WAM`

### `projectId`

The Tableau project LUID to publish into. If this MCP server is configured with a bounded project
context, publishing to a project outside that context returns an error before anything is uploaded.

Example: `cbec32db-a4a2-4308-b5f0-4fc67322f359`

## One of `datasourceUploadId` or `datasourceFilePath`

Exactly one of these must be provided — providing both, or neither, returns an error.

### `datasourceUploadId`

The staged upload id returned by [Request Data Source Upload](request-datasource-upload.md). Use
this for hosted clients that cannot pass a local path. Requires `MCP_S3_BUCKET` to be configured.

Example: `123e4567-e89b-42d3-a456-426614174000`

### `datasourceFilePath`

Path to a local `.tdsx` or `.hyper` file on the MCP server's filesystem. Only supported when staged
S3 uploads are not configured (i.e. `MCP_S3_BUCKET` is unset).

Example: `/path/to/WAM.tdsx`

## Optional arguments

### `description`

A description to set on the published data source.

### `overwrite`

Whether to replace an existing data source with the same name in the project. Overwriting keeps the
existing data source's LUID, so anything wired to it (such as a data app) keeps working.

When `overwrite` is `false` and the name is already taken in the project, the tool returns an error
before uploading anything. (Tableau's asynchronous publish would otherwise fail without a reason.)

Default: `false`

## Response behavior

Publishing runs as a Tableau background job. The tool polls the job for up to
[`PUBLISH_DATASOURCE_JOB_TIMEOUT_SECONDS`](../../configuration/mcp-config/env-vars.md#publish_datasource_job_timeout_seconds)
(default 120 seconds) and returns one of three result shapes:

- **`status: "published"`:** the job finished. Includes the data source's `id` (LUID),
  `contentUrl`, `project` and `webpageUrl`, plus `server`, `siteContentUrl` and `overwritten`
  (`true` when an existing data source was replaced).
- **`status: "pending"`:** the job was still running when the wait ran out. Includes the `jobId`,
  `name` and `projectId`. Check the job later, then find the data source by name and project with
  [List Data Sources](list-datasources.md).
- **`status: "failed"`:** Tableau rejected the file. `message` carries the job's reason. Tableau
  often reports no reason for a failed publish job; in that case the message lists the known
  causes: a multi-table `.hyper`, a malformed `.tds` inside the `.tdsx`, or a `.tdsx` whose extract
  is missing.

A permission error from Tableau (for example, no publish rights on the project) is returned as an
error with a hint to use [List Projects](../projects/list-projects.md) to find a project you can
publish to.

### Permissions after publishing

A successful publish attempts an optional permissions read and returns `permissions`: the data
source's configured user/group permission rules. These are configured rules, not each viewer's
effective access. If the read fails, publishing still succeeds and `permissionsNote` explains that
the rules could not be retrieved.

### Bounded data source context

If this MCP server restricts which data sources can be queried, the newly published data source will
not be on that list. The tool does not change the list; instead it returns `boundedContextNote`,
explaining that a server operator must add the new LUID before
[Query Data Source](query-datasource.md) and [Get Data Source Metadata](get-datasource-metadata.md)
will accept it.

### Catalog lag

[Get Data Source Metadata](get-datasource-metadata.md) reads from Catalog, which can lag publishing by
several minutes. Field descriptions, roles and other catalog metadata may be missing even though the
published data source already contains them. After an overwrite, it may also still return the old
data source description, even though the new `description` takes effect immediately. Clients that
built the data source (such as the hyper-extract skill) should use their own field list rather than
re-reading it right after publishing.

## Example result (published)

```json
{
  "status": "published",
  "datasource": {
    "id": "f95bb3f1-ff78-45ef-af1d-56ce63bc4cdc",
    "name": "WAM",
    "contentUrl": "WAM",
    "project": {
      "id": "cbec32db-a4a2-4308-b5f0-4fc67322f359",
      "name": "Data Apps"
    },
    "webpageUrl": "https://10ax.online.tableau.com/#/site/mcp-test/datasources/1412200"
  },
  "server": "https://10ax.online.tableau.com",
  "siteContentUrl": "mcp-test",
  "overwritten": false,
  "permissions": [
    {
      "group": { "id": "1a2b3c4d-0000-0000-0000-000000000000", "name": "All Users" },
      "capabilities": { "capability": [{ "name": "Read", "mode": "Allow" }] }
    }
  ]
}
```

## Example result (pending)

```json
{
  "status": "pending",
  "jobId": "6d3b1c9e-0000-0000-0000-000000000000",
  "name": "WAM",
  "projectId": "cbec32db-a4a2-4308-b5f0-4fc67322f359"
}
```
