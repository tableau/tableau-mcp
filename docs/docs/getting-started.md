---
sidebar_position: 2
---

# Getting Started

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
      "args": ["@tableau/mcp-server@latest"],
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

## Working with the source code

1. Clone the repository.
2. Install [Node.js](https://nodejs.org/en/download) (tested with 22.15.0 LTS).
3. `npm install`
4. `npm run build`
5. Configure your MCP client using the instructions in the
   [Configuring AI Tools](./configuration/ai-tools-config/README.md) section.

To keep up with repo changes:

1. Pull latest changes: `git pull`
2. `npm install`
3. `npm run build`
4. Relaunch your AI tool or 'refresh' the MCP tools.

<hr />

## Docker Build

To use the Docker version of Tableau MCP, build the image from source:

```bash
$ docker build -t tableau-mcp .
$ docker images
REPOSITORY    TAG       IMAGE ID       CREATED        SIZE
tableau-mcp   latest    c721228b6dd3   15 hours ago   260MB
```

Remember to build the Docker image again whenever you pull the latest repo changes. Also you'll need
to relaunch your AI tool so it starts using the updated image.
