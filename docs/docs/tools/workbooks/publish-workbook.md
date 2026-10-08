---
sidebar_position: 5
---

# Publish Workbook

Publishes a TWB or TWBX workbook from a local file path or staged upload id to Tableau. Provide
`projectId` to publish into a specific project (use [List Projects](../projects/list-projects.md)
with `capability: "Write"` to discover the projects you can publish to). When the `data-apps`
feature flag is enabled and `projectId` is omitted, the workbook is published into your Personal
Space (`personalSpace` defaults to `true`) when the site supports direct-to-personal-space
publishing. `projectId` always takes precedence over `personalSpace`; `personalSpace: false`
without `projectId` returns an error before any file is uploaded.

TWB workbooks are validated up front and uploaded only when validation succeeds, with any blocking
errors returned instead of publishing. TWBX workbooks are uploaded directly and validated by Tableau
as part of publishing, since Tableau cannot pre-validate extracts packaged inside a TWBX.

:::warning[Disabled by Default]

This tool is gated behind the `authoring-tools` feature flag, which
defaults to `false` in `features.json`. It is unavailable unless an administrator enables
`authoring-tools`. See [Feature Flags](../../developers/feature-flags.md).

:::

:::info[Personal Space feature flag]

Direct Personal Space publishing additionally requires the existing `data-apps` feature flag, which
defaults to `false`. When it is off, `personalSpace` is omitted from the advertised tool schema and
description, and `projectId` is required. The execution path also checks the flag: with it off, a
call with `projectId` publishes to that project, and a call without `projectId` is rejected before
API calls or file access. Project publishing remains available when `authoring-tools` is enabled.

After changing file-based flags, restart the MCP server and reconnect clients to refresh the schema.

:::

:::info[Minimum REST API version]

Requires Tableau REST API version 3.29 or later (Tableau Server
2026.2+). Calling this tool against an older server returns an error instead of publishing.

:::

Related tools: [Request Workbook Upload](request-workbook-upload.md),
[List Projects](../projects/list-projects.md)

## Required permissions

- **Site Role**: Requires Explorer (Can Publish) role or higher

## APIs called

- [Publish Workbook](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_publishing.htm#publish_workbook)
- [Validate Workbook and Upload](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#validate_workbook_and_upload)
  (TWB files only)
- [Initiate/Append File Upload](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_publish.htm)
  (TWBX files only)
- [Query Workbook Permissions](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_permissions.htm#query_workbook_permissions)
  (after a project publish, when `data-apps` is enabled)

## Required arguments

### `name`

The name to give the published workbook.

Example: `Q3 Sales Overview`

## One of `workbookUploadId` or `workbookFilePath`

Exactly one of these must be provided — providing both, or neither, returns an error.

### `workbookUploadId`

The staged workbook upload id returned by [Request Workbook Upload](request-workbook-upload.md). Use
this for hosted clients that cannot pass a local path. Requires `MCP_S3_BUCKET` to be configured.

Example: `123e4567-e89b-42d3-a456-426614174000`

### `workbookFilePath`

Path to a local TWB or TWBX workbook file on the MCP server's filesystem. Only supported when staged
S3 uploads are not configured (i.e. `MCP_S3_BUCKET` is unset).

Example: `/path/to/Superstore.twbx`

## Destination: `projectId` or Personal Space

### `projectId`

The Tableau project LUID to publish the workbook into. Use
[List Projects](../projects/list-projects.md) with
[`capability: "Write"`](../projects/list-projects.md#capability) to discover the projects you can
publish to. If this MCP server is configured with a bounded project context,
publishing to a project outside that context returns an error instead of publishing. When
provided, it is always used and `personalSpace` is ignored.

Example: `cbec32db-a4a2-4308-b5f0-4fc67322f359`

### `personalSpace`

This parameter is advertised only when `data-apps` is enabled.

Defaults to `true`. When `projectId` is omitted, the workbook is published into your **Personal
Space**. The tool resolves the caller's Personal Space LUID automatically and sends it as a location
to Tableau; do not pass a Personal Space LUID as `projectId`.

- `projectId` provided: published to that project; `personalSpace` is ignored.
- `projectId` omitted and `personalSpace` true or omitted: published to your Personal Space.
- `projectId` omitted and `personalSpace: false`: returns an error asking for `projectId`.

The tool never falls back to a shared or default project.

The bounded project context is not applied to the caller's own Personal Space; it continues to gate
only `projectId`. Personal Space resolution requires the `tableau:projects:read` OAuth scope, which
is included in the tool's publish scope set.

Example Personal Space request:

```json
{
  "name": "Q3 Sales Overview",
  "workbookFilePath": "/path/to/Superstore.twbx"
}
```

For Personal Space publishes, the tool returns an error without publishing anything if:

- your Personal Space could not be resolved,
- your Personal Space is read-only, or
- the site has direct-to-personal-space publishing disabled.

In addition, some servers accept the request but silently land the workbook in a default project
instead of honoring the Personal Space target. In that case the workbook **is** actually published —
just to an unintended location — and the tool still returns an error so you can delete it there if
unwanted, or republish by passing an explicit `projectId`.

## Optional arguments

### `overwrite`

Whether to overwrite an existing workbook with the same name in the selected destination.

Default: `false`

## Response behavior

The tool returns one of two result shapes:

- **`status: "published"`:** the workbook was validated (TWB) or uploaded (TWBX) and published
  successfully. Includes the published workbook's data, its `url`, and any non-blocking `warnings`
  from validation.
- **`status: "invalid"`:** validation found blocking `errors` (TWB only). Nothing was published.
  `warnings` are still included alongside `errors`.

### Permissions after a project publish

When the `data-apps` feature flag is enabled, a successful project publish also returns
`permissions`: the workbook's configured user/group permission rules. These rules are returned
unchanged in both `structuredContent` and the JSON text content. The tool does not select an
access message or append a published-data-source reminder; the authoring skill interprets the
output using existing task context.

If the optional read fails, publishing still succeeds and `permissionsNote` explains that the
rules could not be retrieved. Personal Space publishes and project publishes with `data-apps`
disabled skip the read and omit both permission fields. Ordinary project publishing remains
available. See [Feature Flags](../../developers/feature-flags.md).

| Publish outcome | Permission fields |
| --- | --- |
| Project publish; permission read succeeds | `permissions` contains the returned rules, including an empty array if none were returned. |
| Project publish; permission read fails or consent is unavailable | `permissionsNote` explains the unavailable read; `permissions` is absent. |
| Project publish; `data-apps` disabled | Neither field is returned; no permission read occurs. |
| Personal Space publish | Neither field is returned; no permission read occurs. |

An omitted capability is not rewritten as a denial. An empty array means no configured rules
were returned, not that nobody has access. The rules do not determine each viewer's effective
access, and successful publishing does not verify permissions on a published parent data source.

## Example result (published)

```json
{
  "status": "published",
  "data": {
    "id": "222ea993-9391-4910-a167-56b3d19b4e3b",
    "name": "Q3 Sales Overview",
    "webpageUrl": "https://10ax.online.tableau.com/#/site/mcp-test/workbooks/1412200",
    "contentUrl": "Q3SalesOverview",
    "project": {
      "id": "cbec32db-a4a2-4308-b5f0-4fc67322f359",
      "name": "Marketing Analytics"
    }
  },
  "url": "https://10ax.online.tableau.com/#/site/mcp-test/views/Q3SalesOverview/Overview",
  "warnings": [
    {
      "severity": "WARNING",
      "message": "Unknown map source is used",
      "line": 245,
      "column": 18,
      "elementName": "map"
    }
  ]
}
```

## Example result (invalid)

```json
{
  "status": "invalid",
  "errors": [
    {
      "severity": "ERROR",
      "message": "Unable to connect to the data source",
      "line": 12,
      "column": 4,
      "elementName": "preferences"
    }
  ],
  "warnings": []
}
```
