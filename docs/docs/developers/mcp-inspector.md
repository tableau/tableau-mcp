---
sidebar_position: 2
---

# MCP Inspector

The [MCP Inspector][mcp-inspector] is a helpful tool to confirm your configuration is correct and to
explore Tableau MCP capabilities.

- Non-Docker users using `stdio` transport should create a `config.json` file in the root of the
  project using `config.stdio.json` as a template.
- Non-Docker users using `http` transport should create a `.env` file in the root of the project
  using `env.example.list` as a template.
- Docker users should create an `env.list` file using `env.example.list` as a template.

After building the project and setting the environment variables, you can start the MCP Inspector
using one of the following commands:

| **Command**                   | **Transport** | **Description**                                                                                   |
| ----------------------------- | ------------- | ------------------------------------------------------------------------------------------------- |
| `npm run inspect`             | `stdio`       | Start the MCP Inspector which runs the server locally using Node.js.                              |
| `npm run inspect:docker`      | `stdio`       | Start the MCP Inspector which runs the server within a Docker container using Node.js.            |
| `npm run inspect:http`        | `http`        | Start the MCP Inspector which runs the server locally using [Express][express].                   |
| `npm run inspect:docker:http` | `http`        | Start the MCP Inspector which runs the server within a Docker container using [Express][express]. |

[mcp-inspector]: https://github.com/modelcontextprotocol/inspector
[express]: https://expressjs.com/
