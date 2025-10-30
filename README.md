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
- `datasourceCaption` (optional): Caption in the workbook; defaults to `datasourceName`.
- `repositoryId` (optional): Identifier used in repository location/dbname; defaults to a sanitized `datasourceName`.
- `revision` (optional): Revision string; defaults to `1.0`.
- `worksheetName` (optional): The initial sheet name; defaults to `Sheet 1`.
- `savedCredentialsViewerId` (optional): If provided, sets `saved-credentials-viewerid` on the connection.

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

- Node.js 22.7.5 or newer
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

## Example Prompts to Client

#### Prompt #1: Querying Data

```
For the Superstore Datasource, what are the top 5 states with the most sales in 2025?
```

#### Response

```
Based on the Superstore Datasource, here are the top 5 states with the most sales in 2025:
  1. California - $146,388.34
  2. New York - $93,922.99
  3. Washington - $65,539.90
  4. Texas - $43,421.76
  5. Pennsylvania - $42,688.31
California leads by a significant margin with over $146,000 in sales, followed by New York with nearly $94,000. These two states alone account for a substantial portion of the total sales across the top 5 states.
```

#### Prompt #2: Content Exploration

```
Find me the most viewed workbook within the last year.
```

#### Response

```
The most viewed workbook within the last year is:

Global Connections
- Owner: John Doe
- Project: Marketing
- Views in last year: 523
- Last Modified: September 2, 2025
- Workbook ID: 111fb672-9401-4913-a167-17b3d89a3e4f
```

#### Prompt #3: Getting a View

```
Show me an image of the "Economy" view in the "Finances" project.
```

#### Response

![Economy View Image](docs/static/img/economy-view.png)
