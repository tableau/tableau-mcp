---
sidebar_position: 2
---

# Getting Started

## Quick Start

Requirements

- Node.js 22.7.5 or newer
- An MCP client e.g. Claude Desktop, Cursor, VS Code, MCP Inspector, etc.

This standard config works in most MCP clients:

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

<hr />

## Node.js Single Executable Applications

Node.js [Single Executable Applications](https://nodejs.org/api/single-executable-applications.html)
(SEA) are a way to package a Node.js application into a single executable file.

This provides a simple method for administrators to deploy Tableau MCP to their users without having
to install Node.js or any other dependencies. Tableau MCP is available as a SEA for both Windows and
Linux.

### Windows

Run [Manage-Server.ps1](https://github.com/tableau/tableau-mcp/blob/main/scripts/Manage-Server.ps1)
which allows you to:

1. Dowload the single executable application for the latest releases.
2. Create a .env file with your Tableau MCP settings.
3. Start the MCP server.
4. Check the status of the MCP server.
5. Upgrade the MCP server.
6. Stop the MCP server.

:::warning

- Never run scripts from untrusted sources.
- Verify the URL of the script correctly points to the main branch of the
  [official Tableau MCP repository](https://github.com/tableau/tableau-mcp) and not a fork.
- Download the script first and inspect it before running it.

:::

Run the script directly from the command line:

```powershell
iex (iwr -Uri "https://raw.githubusercontent.com/tableau/tableau-mcp/refs/heads/main/scripts/Manage-Server.ps1" -UseBasicParsing).Content
```

Or, if you prefer to download the script first:

```powershell
iwr -Uri "https://raw.githubusercontent.com/tableau/tableau-mcp/refs/heads/main/scripts/Manage-Server.ps1" -OutFile "Manage-Server.ps1"
```

### Manual Installation

1. Go to the latest [Tableau MCP release][releases] on GitHub
2. Under Assets, download the `tableau-mcp.zip` (Windows) or `tableau-mcp.tar.gz` (Linux) archive
   for your operating system.
   - If no archives exist, the release is too old and you'll need to choose a newer release.
3. Extract the archive
4. Create a [.env](https://www.dotenv.org/docs/security/env.html) file with your Tableau MCP
   settings. See [Environment Variables](./configuration/mcp-config/env-vars.md) section for more
   details.
5. Run the application

<hr />

## Claude Desktop Extension

Claude Desktop users can also install Tableau MCP as a [Desktop Extension][mcpb]. This is a single
file which can be downloaded and installed without the need to edit any JSON config files.

1. Go to the latest [Tableau MCP release][releases] on GitHub
2. Under Assets, download the `.mcpb` file
3. Have your Tableau MCP settings ready (SERVER, SITE_NAME, etc) ready and follow the [Claude
   Desktop instructions][claude]

The Desktop Extension has been available starting with Tableau MCP v1.5.2.

[mcpb]: https://www.anthropic.com/engineering/desktop-extensions
[releases]: https://github.com/tableau/tableau-mcp/releases
[claude]:
  https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop
