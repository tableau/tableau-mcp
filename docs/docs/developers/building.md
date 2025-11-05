---
sidebar_position: 1
---

# Building From Source

Building from source is appropriate for those working on or contributing to the project, or for
anyone who wants to use the latest changes in between official releases. Developers will need to
have Git and Node installed.

## Working with the source code

1. Clone the repository.
2. Install [Node.js](https://nodejs.org/en/download).
3. `npm install`
4. `npm run build`

To keep up with repo changes:

1. Pull latest changes: `git pull`
2. `npm install`
3. `npm run build`
4. Relaunch your AI tool or 'refresh' the MCP tools.

## Run with Node

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

## Run with Docker

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

## Run with Heroku

See [Deploy to Heroku](../extras/deploy-heroku.md) for new experimental Heroku support.
