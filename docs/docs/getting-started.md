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
