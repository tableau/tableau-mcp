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
following identity, which it substitutes into the workspace files server-side (both output modes):

- **package id**: `com.tableau.mcp.<slug(datappName)>` — lowercase, non-alphanumeric runs collapsed
  to a single hyphen.
- **author**: `<username> via Tableau MCP`, falling back to `Tableau MCP` when no username is
  available.
- **display name**: `datappName` verbatim.

## Response behavior

The result is a single object; the workspace is always fully finalized server-side (identity
tokens substituted, files renamed to their final names, and — if `datasourceLuid` was given — the
datasource wired in). Which delivery field is set depends on whether S3 storage is configured:

- **[`MCP_S3_BUCKET`](../../configuration/mcp-config/env-vars.md#mcp_s3_bucket) configured**: the
  tool zips the finished workspace and uploads it to S3, returning a short-lived presigned `s3URL`
  to the zip. Download and unzip it — there is nothing left to substitute or rename.

- **Otherwise (or if the S3 upload fails)**: the workspace is written to disk under the
  server-controlled
  [`DATA_APP_WORKSPACE_ROOT`](../../configuration/mcp-config/env-vars.md#data_app_workspace_root).
  The result reports the workspace `filePath`. An existing workspace of the same name is never
  overwritten (the tool errors instead).

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
  "s3URL": "https://example-bucket.s3.amazonaws.com/...presigned..."
}
```
