# Getting Started

This guide walks through getting started with Tableau MCP. The easiest way for Cloud users to get started is to use the [remote hosted Tableau MCP server](insert link to remote hosted page). If you're a Server customer and/or you want to run Tableau MCP locally, follow the guide below. 

## Run with npx

The quickest way to run Tableau MCP locally. Requires [Node.js](https://nodejs.org/en/download) 18 or later — no cloning or building needed. Configure your AI tool (MCP client) with:

```json
{
  "mcpServers": {
    "tableau": {
      "command": "npx",
      "args": ["-y", "@tableau/mcp-server@latest"],
      "env": {
        [INSERT CONFIG HERE]
      }
    }
  }
}
```

`npx` will automatically download and run the latest published version from [npm](https://www.npmjs.com/package/@tableau/mcp-server).

## Building From Source

Building from source is appropriate for those working on or contributing to the project, or for
anyone who wants to use the latest changes in between official releases. Developers will need to
have Git and Node installed.

### Working with the source code

1. Clone the repository.
2. Install [Node.js](https://nodejs.org/en/download).
3. `npm install`
4. `npm run build`

To keep up with repo changes:

1. Pull latest changes: `git pull`
2. `npm install`
3. `npm run build`
4. Relaunch your AI tool or 'refresh' the MCP tools.

### Run with Node

After building from source, configure your AI tool (MCP client) to use the MCP server with a snippet
like this:

```json
{
  "mcpServers": {
    "tableau": {
      "command": "node",
      "args": ["full/path/to/build/index.js"],
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

The project includes a template file `config.stdio.json` you can use as an example.

### Run with Docker

To use the Docker version of Tableau MCP, make sure that Docker is running, then build the image
from source:

```bash
$ npm run build:docker
$ docker images
REPOSITORY    TAG       IMAGE ID       CREATED        SIZE
tableau-mcp   latest    c721228b6dd3   15 hours ago   260MB
```

Next, configure your AI tool (MCP client) to use the MCP server with a snippet like this:

```json
{
  "mcpServers": {
    "tableau": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--env-file", "env.list", "tableau-mcp"]
    }
  }
}
```

The project includes a template file `config.docker.json` you can use as an example.

Remember to build the Docker image again whenever you pull the latest repo changes. Also you'll need
to relaunch your AI tool so it starts using the updated image.

### Run with Heroku

See [Deploy to Heroku](../extras/deploy-heroku.md) for new experimental Heroku support.