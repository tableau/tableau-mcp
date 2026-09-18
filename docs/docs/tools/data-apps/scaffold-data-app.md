---
sidebar_position: 1
---

# Scaffold Data App

Scaffolds a new Tableau **data app** workspace: a starter Tableau viz (worksheet) extension that
queries a published datasource live via the Extensions API. Given a single `datappName`, the tool
derives the extension package id, display name, and author and returns a ready-to-edit workspace — a
workbook plus an extension package containing `manifest.json`, `index.html`, and a `src/app.js`
starter you author the query and visualization into.

This tool only **scaffolds and names** the app. It does not author query logic, resolve datasources,
build, publish, or embed data — those are separate steps.

:::warning[Disabled by Default]
This tool is gated behind the `tableau-data-apps` feature flag, which defaults to `false` in
`features.json`. It is unavailable unless an administrator enables `tableau-data-apps`. See
[Feature Flags](../../developers/feature-flags.md).
:::

## Required permissions

- **Site Role**: Requires Explorer (Can Publish) role or higher

## APIs called

None. This tool does not call the Tableau REST API; it emits the starter workspace from a bundled
template.

## Required arguments

### `datappName`

Name for the new data app. Used verbatim as the workspace folder name, the workbook (`.twb`)
filename, and the extension display name, and slugified into the extension package id
(`com.tableau.mcp.<slug>`). Letters, digits, spaces, dot, underscore, and hyphen only; must start and
end with a letter or digit; no path separators or `..`; 1–100 characters.

Example: `Sales Demo` → package id `com.tableau.mcp.sales-demo`

## Derived values

From `datappName` (and the authenticated user's username, when available) the tool derives the
following identity, which it applies to the workspace — substituted into the files on disk for
`stdio`, and carried in the `postUnzip` plan for `http`:

- **package id**: `com.tableau.mcp.<slug(datappName)>` — lowercase, non-alphanumeric runs collapsed
  to a single hyphen.
- **author**: `<username> via Tableau MCP`, falling back to `Tableau MCP` when no username is
  available.
- **display name**: `datappName` verbatim.

## Response behavior

The result is a single object; which delivery field is set depends on the server's transport:

- **Local (`stdio`)**: the workspace is written to disk under the server-controlled
  [`DATA_APP_WORKSPACE_ROOT`](../../configuration/mcp-config/env-vars.md#data_app_workspace_root),
  with identity tokens substituted and files renamed to their final names. The result reports the
  workspace `filePath` (and no `postUnzip` plan). An existing workspace of the same name is never
  overwritten (the tool errors instead).

- **Remote (`http`)**: the template zip is published to S3 out of band; the tool returns a
  short-lived presigned `s3URL` for that object
  (see [`DATA_APP_TEMPLATE_S3_KEY`](../../configuration/mcp-config/env-vars.md#data_app_template_s3_key))
  plus a `postUnzip` plan. The client downloads and unzips the archive, then applies the plan:
  first every `edits` entry (a literal find/replace on the file at `file`), then the `renames` in
  order. The tool itself neither uploads nor downloads the zip. Requires
  [`MCP_S3_BUCKET`](../../configuration/mcp-config/env-vars.md#mcp_s3_bucket) and
  `DATA_APP_TEMPLATE_S3_KEY` to be configured.

## Example result (local / `stdio`)

```json
{
  "datappName": "Sales Demo",
  "filePath": "/var/lib/tableau-mcp/data-app-workspaces/Sales Demo"
}
```

## Example result (remote / `http`)

```json
{
  "datappName": "Sales Demo",
  "s3URL": "https://example-bucket.s3.amazonaws.com/...presigned...",
  "postUnzip": {
    "instructions": "Finalize the workspace after unzipping: first apply every `edits` entry (a literal find/replace on the file at `file`), then apply `renames` in order. Every path is relative to the unzip directory.",
    "edits": [
      {
        "file": "Data App Name/Packages/PackageId/manifest.json",
        "replacements": [
          { "find": "com.example.name", "replace": "com.tableau.mcp.sales-demo" },
          { "find": "<TODO Name>", "replace": "Sales Demo" },
          { "find": "<TODO Username> via Tableau MCP", "replace": "jdoe via Tableau MCP" }
        ]
      },
      {
        "file": "Data App Name/Packages/PackageId/extensions/data-app.trex",
        "replacements": [
          { "find": "<TODO-manifest-id>", "replace": "com.tableau.mcp.sales-demo" },
          { "find": "<TODO Username> via Tableau MCP", "replace": "jdoe via Tableau MCP" }
        ]
      }
    ],
    "renames": [
      {
        "from": "Data App Name/Packages/PackageId",
        "to": "Data App Name/Packages/com.tableau.mcp.sales-demo"
      },
      { "from": "Data App Name/Data App Name.twb", "to": "Data App Name/Sales Demo.twb" },
      { "from": "Data App Name", "to": "Sales Demo" }
    ]
  }
}
```
