---
sidebar_position: 1
---

# Scaffold Data App

Scaffolds a new Tableau **data app** workspace: a starter Tableau viz (worksheet) extension that
queries a published datasource live via the Extensions API. Given a single `datappName`, the tool
derives the extension package id and display name and returns a ready-to-edit workspace — a
workbook plus an extension package containing `index.html` and a `src/app.js` starter you author
the query and visualization into.

This tool only **scaffolds and names** the app — it does not wire a datasource, author query
logic, build, publish, or embed data. Those remain separate steps.

:::warning[Disabled by Default]
This tool is gated behind the `tableau-data-apps` feature flag, which defaults to `false` in
`features.json`. It is unavailable unless an administrator enables `tableau-data-apps`. See
[Feature Flags](../../developers/feature-flags.md).
:::

## Required permissions

- **Site Role**: Requires Explorer (Can Publish) role or higher

## APIs called

None — the tool emits the starter workspace from a bundled or pre-published template with no
Tableau REST API calls.

## Required arguments

### `datappName`

Name for the new data app. Used verbatim as the workspace folder name, the workbook (`.twb`)
filename, and the extension display name, and slugified into the extension package id
(`com.tableau.mcp.<slug>`). Letters, digits, spaces, dot, underscore, and hyphen only; must start and
end with a letter or digit; no path separators or `..`; 1–100 characters.

Example: `Sales Demo` → package id `com.tableau.mcp.sales-demo`

## Derived values

From `datappName` the tool derives the following identity:

- **package id**: `com.tableau.mcp.<slug(datappName)>` — lowercase, non-alphanumeric runs collapsed
  to a single hyphen.
- **display name**: `datappName` verbatim.

The extension's author is fixed to `Tableau MCP` in the template; it is not derived per call.

## Response behavior

The result is a single object. Where and how identity substitution happens depends on whether S3
storage is configured:

- **Otherwise (disk output)**: the server walks the bundled template, substitutes the identity
  tokens, and writes the finished files under the server-controlled
  [`DATA_APP_WORKSPACE_ROOT`](../../configuration/mcp-config/env-vars.md#data_app_workspace_root).
  The workspace is fully finalized; the result reports the `filePath`. An existing workspace of the
  same name is never overwritten (the tool errors instead).

- **[`MCP_S3_BUCKET`](../../configuration/mcp-config/env-vars.md#mcp_s3_bucket) configured (S3
  output)**: the template zip is already published to S3 out of band (see
  [`DATA_APP_TEMPLATE_S3_KEY`](../../configuration/mcp-config/env-vars.md#data_app_template_s3_key));
  the tool only presigns a short-lived GET URL for that existing object — it never builds or
  uploads a zip. The result's `s3URL` points at the **un-substituted** template; `postUnzip`
  describes the literal find/replace edits and path renames to apply after downloading and
  unzipping to finalize the workspace.

Datasource wiring is never performed by this tool in either mode — it is the caller's
responsibility, applied to the finalized workbook after this tool returns.

## Example result (disk output)

```json
{
  "datappName": "Sales Demo",
  "filePath": "/var/lib/tableau-mcp/data-app-workspaces/Sales Demo"
}
```

## Example result (S3 output)

```json
{
  "datappName": "Sales Demo",
  "s3URL": "https://example-bucket.s3.amazonaws.com/...presigned...",
  "postUnzip": {
    "instructions": "Finalize the workspace after unzipping: first apply every `edits` entry (a literal find/replace on the file at `file`), then apply `renames` in order. Every path is relative to the unzip directory.",
    "edits": [
      {
        "file": "Data App Name/Data App Name.twb",
        "replacements": [
          { "find": "TODO-MANIFEST-ID", "replace": "com.tableau.mcp.sales-demo" },
          { "find": "TODO App Name", "replace": "Sales Demo" }
        ]
      }
    ],
    "renames": [
      { "from": "Data App Name/Packages/TODO-MANIFEST-ID", "to": "Data App Name/Packages/com.tableau.mcp.sales-demo" },
      { "from": "Data App Name/Data App Name.twb", "to": "Data App Name/Sales Demo.twb" },
      { "from": "Data App Name", "to": "Sales Demo" }
    ]
  }
}
```
