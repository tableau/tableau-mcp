---
sidebar_position: 12
---

# Scaffold a Desktop data app

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Prepares a data app package and worksheetFile for an open sheet. The fragment uses that sheet's live name and stamps worksheetId as `simple-id`. Apply with apply-worksheet; pass worksheetId as worksheetName (stable id). Replaces that sheet; does not create or rename.

## APIs called

Talks to the running %product_name% instance through the local **%product_name% %ecapi_name%**.

- Lists the workbook's datasources to match `datasourceId`.
  - `GET /v<x>/workbook/datasources`
- Lists the workbook's worksheets to match `worksheetId`.
  - `GET /v<x>/workbook/worksheets`

## Required arguments

### `datappName`
Display name for the new data app.

### `worksheetId`

Stable External API worksheet id; stamped as `simple-id` for apply.

### `datasourceId`

External API datasource id.

## Optional arguments

### `session`

Session ID; optional if pinned or unique.

{/* tool-details */}
## Derived values

From `datappName` the tool derives the following identity:

- **package id**: `com.tableau.mcp.<slug(datappName)>.<suffix>` — lowercase, non-alphanumeric runs collapsed
  to a single hyphen; `<suffix>` is 8 random hex characters.
- **display name**: `datappName` verbatim.

- **version**: `1.0.0`.
- **author**: `Tableau MCP`.

The version and author are fixed defaults, not derived per call. All four values are placeholders
in the template (`TODO-MANIFEST-ID`, `TODO App Name`, `TODO-MANIFEST-VERSION`, `TODO Author Name`),
filled by the tool in `data-app.trex` and `manifest.json` when it copies the package, so they always agree.

## Package manifest

The extension package ships a JSON manifest at `<sourceDir>/manifest.json`. After the tool fills in
the placeholders, its `id`, `version`, `name`, and `author` match `data-app.trex`:

```json
{
  "id": "com.tableau.mcp.sales-demo.3f9a1c2e",
  "version": "1.0.0",
  "manifestVersion": "0.1",
  "name": "Sales Demo",
  "author": "Tableau MCP",
  "requestedOrigins": ""
}
```

`requestedOrigins` is always scaffolded empty. To let the app call external origins, set it to a
space-separated list of them, the same form as a Content-Security-Policy source list (for example
`"https://api.example.com https://cdn.example.com"`).

## Response behavior

The tool copies the template package to a new `<slug>-<suffix>` folder under
[`TABLEAU_DATA_APP_WORKSPACE_DIR`](../../configuration/mcp-config/env-vars.md#tableau_data_app_workspace_dir),
binds it to the datasource, and writes the worksheet fragment to `worksheetFile` in the cache. The
result is a single object with `packageId`, `sourceDir`, `worksheetFile`, `extensionsDatasourceId`,
`worksheetId`, and `worksheetName`.

## Example result

```json
{
  "packageId": "com.tableau.mcp.sales-demo.3f9a1c2e",
  "sourceDir": "/Users/me/DataApps/sales-demo-3f9a1c2e",
  "worksheetFile": "/Users/me/.tableau-mcp/cache/data-app-worksheet-1795046400000-k3j9x.xml",
  "extensionsDatasourceId": "federated.0abc123",
  "worksheetId": "sheet-sales",
  "worksheetName": "Sales by Region"
}
```
{/* /tool-details */}
