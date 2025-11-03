# Tableau MCP

[![Tableau Supported](https://img.shields.io/badge/Support%20Level-Tableau%20Supported-53bd92.svg)](https://www.tableau.com/support-levels-it-and-developer-tools)

[![Build and Test](https://github.com/tableau/tableau-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/tableau/tableau-mcp/actions/workflows/ci.yml)

[![npm](https://img.shields.io/npm/v/@tableau/mcp-server)](https://www.npmjs.com/package/@tableau/mcp-server)

## Overview

Tableau MCP is a suite of developer primitives, including tools, resources and prompts, that will
make it easier for developers to build AI applications that integrate with Tableau.

## Official Documentation

https://tableau.github.io/tableau-mcp/
## New Tool: Generate Workbook XML

The `generate-workbook-xml` tool creates a Tableau TWB (XML) string that connects to a published data source on Data Server.

Parameters:

- `datasourceName` (required): The published data source display name (friendly name).
- `publishedDatasourceId` (required): The published datasource's repository ID.
- `datasourceCaption` (optional): Caption in the workbook; defaults to `datasourceName`.
- `revision` (optional): Revision string; defaults to `1.0`.
- `worksheetName` (optional): The initial sheet name; defaults to `Sheet 1`.

Output is a TWB XML string you can save to a `.twb` file. Server URL and site are taken from the MCP server configuration (`SERVER`, `SITE_NAME`).

## New Tool: Inject Viz Into Workbook XML

The `inject-viz-into-workbook-xml` tool accepts an existing TWB XML string and injects a basic visualization into a worksheet by:
- Referencing the datasource in the sheet's `<view>` block
- Adding `<datasource-dependencies>` for the specified fields
- Binding fields to the `<rows>` and `<cols>` shelves

Parameters:

- `workbookXml` (required): The TWB XML string to modify.
- `worksheetName` (optional): Target sheet; default is the first.
- `datasourceConnectionName` (optional): Datasource `name` to reference; default is the first found.
- `datasourceCaption` (optional): Datasource caption used in `<view>`.
- `columns` (required): Array of dimensions for the Columns shelf.
- `rows` (required): Array of `{ field, aggregation? }` measures for the Rows shelf.

Returns an updated TWB XML string you can save to `.twb`.


## Quick Start

### Requirements

- Node.js 20 or newer
- An MCP client e.g. Claude Desktop, Cursor, VS Code, MCP Inspector, etc.

Standard config works in most MCP clients:

```json
{
  "mcpServers": {
    "tableau": {
      "command": "npx",
      "args": ["-y", "@tableau/mcp-server@latest"],
      "env": {
        "SERVER": "https://my-tableau-server.com",
        "SITE_NAME": "my_site",
        "PAT_NAME": "my_pat",
        "PAT_VALUE": "pat_value"
      }
    }
  }
}
```

## Deploy to Heroku

[![Deploy to Heroku](https://www.herokucdn.com/deploy/button.svg)](https://www.heroku.com/deploy?template=https://github.com/tableau/tableau-mcp)
