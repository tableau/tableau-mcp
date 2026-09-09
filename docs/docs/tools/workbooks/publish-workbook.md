---
sidebar_position: 5
---

# Publish Workbook

Publishes a TWB or TWBX workbook from a local file path or staged upload id to the specified
Tableau project. Use [List Projects](../projects/list-projects.md) to discover project IDs.

TWB workbooks are validated up front and uploaded only when validation succeeds, with any
blocking errors returned instead of publishing. TWBX workbooks are uploaded directly and
validated by Tableau as part of publishing, since Tableau cannot pre-validate extracts packaged
inside a TWBX.

:::warning[Disabled by Default]
This tool is gated behind the `authoring-tools` feature flag, which defaults to `false` in `features.json`. It is unavailable unless an administrator enables `authoring-tools`. See [Feature Flags](../../developers/feature-flags.md).
:::

:::info[Minimum REST API version]
Requires Tableau REST API version 3.29 or later (Tableau Server 2026.2+). Calling this tool
against an older server returns an error instead of publishing.
:::

Related tools: [Request Workbook Upload](request-workbook-upload.md), [List Projects](../projects/list-projects.md)

## APIs called

- [Publish Workbook](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_publishing.htm#publish_workbook)
- [Validate Workbook and Upload](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#validate_workbook_and_upload)
  (TWB files only)
- [Initiate/Append File Upload](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_publish.htm)
  (TWBX files only)

## Required arguments

### `name`

The name to give the published workbook.

Example: `Q3 Sales Overview`

### `projectId`

The Tableau project LUID to publish the workbook into. Use
[List Projects](../projects/list-projects.md) to discover available project IDs.

If this MCP server is configured with a bounded project context, publishing to a project outside
that context returns an error instead of publishing.

Example: `cbec32db-a4a2-4308-b5f0-4fc67322f359`

## One of `workbookUploadId` or `workbookFilePath`

Exactly one of these must be provided — providing both, or neither, returns an error.

### `workbookUploadId`

The staged workbook upload id returned by [Request Workbook Upload](request-workbook-upload.md).
Use this for hosted clients that cannot pass a local path. Requires `MCP_S3_BUCKET` to be
configured.

Example: `123e4567-e89b-42d3-a456-426614174000`

### `workbookFilePath`

Path to a local TWB or TWBX workbook file on the MCP server's filesystem. Only supported when
staged S3 uploads are not configured (i.e. `MCP_S3_BUCKET` is unset).

Example: `/path/to/Superstore.twbx`

## Optional arguments

### `overwrite`

Whether to overwrite an existing workbook with the same name in the target project.

Default: `false`

## Response behavior

The tool returns one of two result shapes:

- **`status: "published"`:** the workbook was validated (TWB) or uploaded (TWBX) and published
  successfully. Includes the published workbook's data, its `url`, and any non-blocking
  `warnings` from validation.
- **`status: "invalid"`:** validation found blocking `errors` (TWB only). Nothing was published.
  `warnings` are still included alongside `errors`.

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
