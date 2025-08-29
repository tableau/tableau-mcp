---
sidebar_position: 1
---

# Claude Desktop Extension

Anthropic recently added support for Desktop Extensions (DXT) that can simplify loading and
configuring MCP servers in Claude Desktop. A Desktop Extension is self-contained and the end-user
doesn't need to worry about git, command lines, or Node.

To build the DXT file for this project:

1. Pull latest changes: `git pull`
2. `npm install`
3. `npm run build:dxt`
4. Use the output file `tableau-mcp.dxt` and install into Claude Desktop

:::danger

If you build this from your local repo, all files will be included. Make sure you don't have any
environment files that contain sensitive data like personal access tokens.

:::

For more information about Desktop Extensions, see the
[June 2025 Anthropic blog post](https://www.anthropic.com/engineering/desktop-extensions) and the
[Anthropic DXT GitHub project](https://github.com/anthropics/dxt).
