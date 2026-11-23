# Tableau MCP for Tableau Desktop

[![npm](https://img.shields.io/npm/v/@tableau/mcp-server-desktop)](https://www.npmjs.com/package/@tableau/mcp-server-desktop)

An MCP server that lets an AI tool author workbooks in a running copy of Tableau Desktop. It talks
to Desktop on the same computer through the External Client API, over stdio.

For Tableau Server and Tableau Cloud, use [`@tableau/mcp-server`](https://www.npmjs.com/package/@tableau/mcp-server)
instead.

## Requirements

- [Node.js](https://nodejs.org/en/download) 22.7.5 or later.
- The most recent public release of Tableau Desktop, or later, running on the same computer.
- The External Client API turned on in Desktop. Follow
  [Use Tableau Studio Headless](https://help.tableau.com/current/api/studio-dev-guide/en-us/use-tableau-studio-headless.html),
  then restart Desktop.

## Use it

Add the server to your AI tool's MCP configuration:

```json
{
  "mcpServers": {
    "tableau-desktop": {
      "command": "npx",
      "args": ["-y", "@tableau/mcp-server-desktop@latest"],
      "env": {
        "TABLEAU_MCP_CACHE_DIR": "/absolute/path/to/a/cache/folder"
      }
    }
  }
}
```

Write `@latest` out. Without a version, `npx` can keep reusing the copy it downloaded first.

Set `TABLEAU_MCP_CACHE_DIR` to a full path. Otherwise the server's cache sits inside npm's own
cache folder.

The server starts without Desktop running. Tools that need Desktop say so when you call them. If
more than one Desktop is open, call `list-instances` and pass the session it returns.

## Configuration

This package reads settings from its environment only. It does not read a `.env` file from the
folder it starts in. For the settings it reads, see the
[environment variable reference](https://tableau.github.io/tableau-mcp/docs/configuration/mcp-config/env-vars#desktop).

The package runs over stdio only. To run the Web server over HTTP, use `@tableau/mcp-server` or
the hosted Tableau MCP server.

## More

- [Documentation](https://tableau.github.io/tableau-mcp/docs/getting-started/desktop)
- [Source](https://github.com/tableau/tableau-mcp)
