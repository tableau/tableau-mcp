---
sidebar_position: 6
---

# Publish Workbook

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Publishes a TWB or TWBX workbook from a local file path or staged upload id to a Tableau project. TWB workbooks are validated first and uploaded only when validation succeeds; blocking errors are returned instead of publishing. TWBX workbooks are uploaded directly and validated by Tableau as part of publishing, since Tableau cannot pre-validate extracts packaged inside a TWBX.

## APIs called

Talks to Tableau Cloud or Tableau Server.

- Validates and uploads a TWB, or uploads a TWBX, then publishes it to the given project.
- Reads the published workbook's permission rules. This read is optional; see [Permissions after publishing](#permissions-after-publishing).

## Required arguments

### `name`

The name to give the published workbook.

### `projectId`

The Tableau project LUID to publish the workbook into. Use [`list-projects`](../projects/list-projects.md) to discover available project IDs. If this MCP server is configured with a bounded project context, a project outside that context returns an error instead of publishing.

Example: `cbec32db-a4a2-4308-b5f0-4fc67322f359`

## Optional arguments

### `workbookUploadId`

Staged workbook upload id returned by [`request-workbook-upload`](request-workbook-upload.md). Use this for hosted clients that cannot pass a local path. Each upload id can be published once. Requires the server to set [`MCP_S3_BUCKET`](../../configuration/mcp-config/env-vars.md#mcp_s3_bucket).

Example: `123e4567-e89b-42d3-a456-426614174000`

:::note
Provide exactly one of `workbookUploadId` or `workbookFilePath`.

- Passing both is refused with `Provide either workbookFilePath or workbookUploadId, not both.`
- Passing neither is refused with `Either workbookFilePath or workbookUploadId must be provided. For local MCP servers, pass workbookFilePath. For hosted clients, call request-workbook-upload first and pass workbookUploadId.`
:::

<hr />

### `workbookFilePath`

Path to a local TWB or TWBX workbook file on the MCP server filesystem. Only supported when staged S3 uploads are not configured. When `MCP_S3_BUCKET` is set, the tool refuses with `workbookFilePath is only supported when staged S3 uploads are not configured. Call request-workbook-upload first and pass workbookUploadId.`

Example: `/path/to/Superstore.twbx`

:::note
`workbookFilePath must point to a .twb or .twbx file.` `workbookFilePath must not point to an empty workbook file.`
:::

<hr />

### `overwrite`

Whether to overwrite an existing workbook with the same name in the target project. Defaults to `false`.

{/* tool-details */}
## Example

```json
{
  "name": "Q3 Sales Overview",
  "projectId": "cbec32db-a4a2-4308-b5f0-4fc67322f359",
  "workbookFilePath": "/path/to/Superstore.twbx",
  "overwrite": false
}
```

## Response behavior

The tool returns one of two result shapes:

- **`status: "published"`:** the workbook was validated (TWB) or uploaded (TWBX) and published.
  Includes the published workbook's `data`, its `url`, and any non-blocking `warnings` from
  validation.
- **`status: "invalid"`:** validation found blocking `errors` (TWB only). Nothing was published.
  `warnings` are still included alongside `errors`.

A staged upload is deleted after a successful publish, so each `workbookUploadId` can be published
once.

### Permissions after publishing

After a successful publish, the tool reads the workbook's permission rules and returns them in
`permissions`: the configured user and group rules, returned as Tableau reports them. An empty
array means no rules were returned, not that nobody has access. The rules are not each viewer's
effective access, and publishing does not check permissions on a published data source the
workbook uses.

This read is optional. If it fails, or the caller did not grant its OAuth scope, publishing still
succeeds and `permissionsNote` explains why `permissions` is missing.

| Publish outcome | Permission fields |
| --- | --- |
| Permission read succeeds | `permissions` contains the returned rules, including an empty array if none were returned. |
| Permission read fails | `permissionsNote` is `Published successfully, but the workbook permission rules could not be retrieved.`; `permissions` is absent. |
| Optional scope not granted | `permissionsNote` says the rules were not retrieved because the optional scope was not granted; `permissions` is absent. |

### Errors

When Tableau rejects the publish with a 4xx error, the tool returns guidance for the Tableau error
code followed by Tableau's own message. For example, code `403130` returns
`A workbook with this name already exists. Set overwrite to true to replace it, or choose a different name.`

The tool requires Tableau REST API 3.29 or later (Tableau Server 2026.2 or later).

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
  ],
  "permissions": []
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
{/* /tool-details */}
