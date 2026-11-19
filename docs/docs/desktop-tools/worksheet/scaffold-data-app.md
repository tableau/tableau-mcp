---
sidebar_position: 12
---

# Scaffold a Desktop data app

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Prepares a data app package and a worksheet file for a worksheet in the workbook open in %product_name%. The worksheet file uses that sheet's live name and stamps `worksheetId` as its `simple-id`. Apply it with [`apply-worksheet`](apply-worksheet.md), passing `worksheetId` as `worksheetName`. The apply replaces that worksheet; it does not create or rename a sheet. For the Web tool of the same name, see [Scaffold Data App](../../web-tools/data-apps/scaffold-data-app.md).

:::note[Not read-only]
This tool writes a package tree under [`TABLEAU_DATA_APP_WORKSPACE_DIR`](../../configuration/mcp-config/env-vars.md#tableau_data_app_workspace_dir) and a worksheet file to the cache. It does not change the workbook until you call `apply-worksheet`. Each call writes a new package, so it is not idempotent.
:::

## APIs called

This tool reads the workbook open in the running %product_name% instance, not the Tableau Cloud or Tableau Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: each call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface. A workbook must be open in the target session.

- Settles on which %product_name% session to target before anything is sent. Resolved in-process (not an API call).
- Reads the workbook's datasources so `datasourceId` can be matched to one live datasource.
  - `GET /v<x>/workbook/datasources` — list the workbook's datasources. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/listWorkbookDatasources)
- Reads the workbook's worksheets so `worksheetId` can be matched to one open worksheet.
  - `GET /v<x>/workbook/worksheets` — list the worksheets in the open workbook. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/listWorksheets)
- Copies the bundled data app template into a new folder under the workspace directory and fills in its name, package id, version, author, and bound datasource. Done in-process (not an API call).
- Writes the worksheet XML to a cache file for `apply-worksheet`. Done in-process (not an API call).

## Required arguments

### `datappName`

Display name for the new data app. 1-100 characters: letters, digits, spaces, dot, underscore, or hyphen. It must start and end with a letter or digit and must not contain `..`. A name that breaks these rules is refused with error type `invalid-data-app-name`.

#### Example

`"Sales Demo"`

<hr />

### `worksheetId`

Stable %ecapi_name% id of the worksheet to replace. It is stamped as the worksheet's `simple-id` so `apply-worksheet` targets that sheet. Get it from [`get-sheets`](get-sheets.md).

#### Example

`"sheet-sales"`

<hr />

### `datasourceId`

%ecapi_name% id of the datasource the app binds to. Get it from [`get-datasources`](../data-source/get-datasources.md).

#### Example

`"Sample%20-%20Superstore"`

## Optional arguments

### `session`

Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected or a session has been pinned).

#### Example

`"12345"`

## Notes and caveats

- **Workspace directory required.** Set [`TABLEAU_DATA_APP_WORKSPACE_DIR`](../../configuration/mcp-config/env-vars.md#tableau_data_app_workspace_dir) to an absolute directory. Otherwise the tool refuses with `Set TABLEAU_DATA_APP_WORKSPACE_DIR to an absolute directory before scaffolding a Desktop data app.`
- **Filled in on the server.** Unlike the Web tool, this tool fills in the template itself. There is no `postUnzip` plan to apply.
- **Unique package per call.** The package id is `com.tableau.mcp.<slug>.<suffix>` and the folder is `<slug>-<suffix>`, where `<suffix>` is 8 random hex characters. Calling twice with the same name writes two packages.
- **Apply step.** Call `apply-worksheet` with `worksheetFile` from the result and `worksheetName` set to `worksheetId`.

### Errors

| Error type | When |
| --- | --- |
| `invalid-data-app-name` | `datappName` breaks the naming rules. |
| `data-app-workspace-unconfigured` | `TABLEAU_DATA_APP_WORKSPACE_DIR` is unset or not absolute. |
| `data-app-template-missing` | The build does not include `templates/data-app-template.zip`. |
| `worksheet-not-selected` | `worksheetId` does not match exactly one open worksheet. The message lists the available ids and names. |
| `datasource-not-selected` | `datasourceId` does not match exactly one live datasource. The message lists the available ids and captions. |
| `data-app-path-rejected` | The package folder would land outside the workspace directory. |

## Example results

### Package prepared

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

### Then apply it

```json
{
  "worksheetFile": "/Users/me/.tableau-mcp/cache/data-app-worksheet-1795046400000-k3j9x.xml",
  "worksheetName": "sheet-sales"
}
```

## Related

- [`apply-worksheet`](apply-worksheet.md) — applies the prepared worksheet file to the live workbook.
- [`get-sheets`](get-sheets.md) — lists worksheet ids for `worksheetId`.
- [`get-datasources`](../data-source/get-datasources.md) — lists datasource ids for `datasourceId`.
