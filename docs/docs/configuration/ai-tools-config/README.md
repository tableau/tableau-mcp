# Configuring AI Tools

AI tools can connect to Tableau MCP in two different ways:

- Running locally: the tool runs Tableau MCP as needed using `node build/index.js`
- Running in Docker: the tool runs Tableau MCP as a Docker container

Either method will work. The Docker path is slightly easier because all the environment variables
are stored in one file rather than in each AI tool's config section.

<hr />

For **running locally**, create an `mcpServers` JSON snippet using `config.stdio.json` or
`config.http.json` as a template, depending on your desired transport type.

For `stdio` transport, it should look similar to this:

```json
{
  "mcpServers": {
    "tableau": {
      "command": "node",
      "args": ["/full-path-to-tableau-mcp/build/index.js"],
      "env": {
        "TRANSPORT": "stdio",
        "SERVER": "https://my-tableau-server.com",
        "SITE_NAME": "",
        "PAT_NAME": "",
        "PAT_VALUE": "",
        ... etc
      }
    }
  }
}
```

<hr />

For **running with Docker**, create an `env.list` file in the root of the project using
`env.example.list` as a template.

Also create an `mcpServers` JSON snippet using `config.docker.json` as a template. Make sure to
include the full path to your `env.list` file. It should look similar to this:

```json
{
  "mcpServers": {
    "tableau": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "--env-file",
        "/full-path-to-tableau-mcp/env.list",
        "tableau-mcp"
      ]
    }
  }
}
```

These config files will be used in tool configuration explained in upcoming sections.
