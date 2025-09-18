---
sidebar_position: 1
---

# Claude MCP Bundle

Anthropic recently added support for MCP Bundles (MCPB)—previously called Desktop Extensions
(DXT)—that can simplify loading and configuring MCP servers in Claude Desktop. An MCP Bundle is
self-contained and the end-user doesn't need to worry about git, command lines, or Node.

To build the MCPB file for this project:

1. Pull latest changes: `git pull`
2. `npm install`
3. `npm run build:mcpb`
4. Use the output file `tableau-mcp.mcpb` and install into Claude Desktop

:::danger

If you build this from your local repo, unnecessary and potentially sensitive files will be
[automatically excluded](https://github.com/anthropics/mcpb/blob/2825da1d6a8d094cc5515bdfdd5a72ebf257cc10/CLI.md#excluded-files)
from the generated MCPB file. However, there may be some gaps in the exclusion list defined in the
[`.mcpbignore` file](https://github.com/tableau/tableau-mcp/blob/main/.mcpbignore). If you find any
gaps, please open an issue or submit a pull request.

:::

For more information about MCP Bundles, see the
[June 2025 Anthropic blog post](https://www.anthropic.com/engineering/desktop-extensions) and the
[Anthropic MCPB GitHub project](https://github.com/anthropics/mcpb).
