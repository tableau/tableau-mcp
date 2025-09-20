---
sidebar_position: 2
---

# Claude Desktop

For Claude Desktop, open the settings dialog, select the **Developer** section, and click **Edit
Config**.

Add the `tableau` MCP server to the `mcpServers` object in the config using `config.stdio.json`,
`config.http.json`, or `config.docker.json` as a template.

## Claude Desktop Extension

Claude Desktop users can also install Tableau MCP as a [Desktop Extension][mcpb]. This is a single
file which can be downloaded and installed without the need to edit any JSON config files.

1. Go to the latest [Tableau MCP release][releases] on GitHub
2. Under Assets, download the `.mcpb` file
3. Have your Tableau MCP settings (SERVER, SITE_NAME, etc) ready and follow the [Claude Desktop
   instructions][claude]

The Desktop Extension has been available starting with Tableau MCP v1.5.2.

[mcpb]: https://www.anthropic.com/engineering/desktop-extensions
[releases]: https://github.com/tableau/tableau-mcp/releases
[claude]:
  https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop
