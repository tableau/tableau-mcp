# Tableau MCP

[![Tableau Supported](https://img.shields.io/badge/Support%20Level-Tableau%20Supported-53bd92.svg)](https://www.tableau.com/support-levels-it-and-developer-tools)

[![Build and Test](https://github.com/tableau/tableau-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/tableau/tableau-mcp/actions/workflows/ci.yml)

## Overview

Tableau MCP is a suite of developer primitives, including tools, resources and prompts, that will
make it easier for developers to build AI-applications that integrate with Tableau.

Key features:

- Provides access to Tableau published data sources through the
  [VizQL Data Service (VDS) API](https://help.tableau.com/current/api/vizql-data-service/en-us/index.html)
- Supports collecting data source metadata (columns with descriptions) through the Tableau
  [Metadata API](https://help.tableau.com/current/api/metadata_api/en-us/docs/meta_api_start.html)
- Usable by AI tools which support MCP Tools (e.g., Claude Desktop, Cursor and others)
- Works with any published data source on either Tableau Cloud or Tableau Server

The following MCP tools are currently implemented:

| **Variable**     | **Description**                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| list-datasources | Retrieves a list of published data sources from a specified Tableau site ([REST API][query])   |
| list-fields      | Fetches field metadata (name, description) for the specified datasource ([Metadata API][meta]) |
| query-datasource | Run a Tableau VizQL query ([VDS API][vds])                                                     |
| read-metadata    | Requests metadata for the specified data source ([VDS API][vds])                               |

Note: The Tableau MCP project is currently in early development. As we continue to enhance and
refine the implementation, the available functionality and tools may evolve. We welcome feedback and
contributions to help shape the future of this project.

## Getting Started

### Install Prerequisites

Follow these steps to install Tableau MCP for the first time:

1. Clone the repository
2. Install [Node.js](https://nodejs.org/en/download) (tested with 22.15.0 LTS)
3. `npm install`
4. `npm run build`

To keep up with repo changes:

1. Pull latest changes: `git pull`
2. `npm install`
3. `npm run build`
4. Relaunch your AI tool or 'refresh' the MCP tools

### Docker Build

To use the Docker version of Tableau MCP, build the image from source:

```bash
$ docker build -t tableau-mcp .
$ docker images
REPOSITORY    TAG       IMAGE ID       CREATED        SIZE
tableau-mcp   latest    c721228b6dd3   15 hours ago   260MB
```

Remember to build the Docker image again whenever you pull the latest repo changes. Also you'll need
to relaunch your AI tool so it starts using the updated image.

## Tableau Configuration

Tableau MCP works with both Tableau Server and Tableau cloud data with these prerequisites:

- Only published data sources are supported
- VDS (VizQL Data Service) must be enabled (Tableau Server users may need to
  [enable it](https://help.tableau.com/current/server-linux/en-us/cli_configuration-set_tsm.htm#featuresvizqldataservicedeploywithtsm))
- Metadata API must be enabled (Tableau Server users may need to
  [enable it](https://help.tableau.com/current/api/metadata_api/en-us/docs/meta_api_start.html#enable-the-tableau-metadata-api-for-tableau-server))

## Tableau Authentication

Tableau MCP requires authentication in order to connect with your Tableau Server or Tableau Cloud
site. This authenticated user must have access to the published data source(s) you plan to access.

Provide your Tableau [Personal Access Token][pat] by setting the `PAT_NAME` and `PAT_VALUE`
environment variables. See [Environment Variables](#environment-variables) for more information.

## Configuring AI Tools

AI tools can connect to Tableau MCP in two different ways:

- Running locally: the tool runs Tableau MCP as needed using `node build/index.js`
- Running in Docker: the tool runs Tableau MCP as a Docker container

Either method will work. The Docker path is slightly easier because all the environment variables
are stored in one file rather than in each AI tool's config section.

### Environment Variables

Depending on your desired mode, create your environment configuration as follows:

For **running locally**, create an `mcpServers` JSON snippet using `config.example.json` as a
template. It should look similar to this:

```json
{
  "mcpServers": {
    "tableau": {
      "command": "node",
      "args": ["/full-path-to-tableau-mcp/build/index.js"],
      "env": {
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

For **running with Docker**, create an `env.list` file in the root of the project using
`env.example.list` as a template. Also create an `mcpServers` JSON snippet like
`config.docker.json`. It should look similar to this:

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

These config files will be used in tool configuration explained below.

#### Required Environment Variables

| **Variable** | **Description**                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `SERVER`     | The URL of the Tableau server.                                                                                    |
| `SITE_NAME`  | The name of the Tableau site to use. For Tableau Server, set this to an empty string to specify the default site. |
| `PAT_NAME`   | The name of the Tableau [Personal Access Token][pat] to use.                                                      |
| `PAT_VALUE`  | The value of the Tableau [Personal Access Token][pat] to use.                                                     |

#### Optional Environment Variables

| **Variable**             | **Description**                                                                                     | **Default**                        | **Note**                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `DEFAULT_LOG_LEVEL`      | The default logging level of the server.                                                            | `debug`                            |                                                                                            |
| `DATASOURCE_CREDENTIALS` | A JSON string that includes usernames and passwords for any datasources that require them.          | Empty string                       | Format is provided in the [DATASOURCE_CREDENTIALS](#datasource_credentials) section below. |
| `DISABLE_LOG_MASKING`    | Disable masking of credentials in logs. For debug purposes only.                                    | `false`                            |                                                                                            |
| `INCLUDE_TOOLS`          | A comma-separated list of tool names to include in the server. Only these tools will be available.  | Empty string (_all_ are included)  | For a list of available tools, see [toolName.ts](src/tools/toolName.ts).                   |
| `EXCLUDE_TOOLS`          | A comma-separated list of tool names to exclude from the server. All other tools will be available. | Empty string (_none_ are excluded) | Cannot be provided with `INCLUDE_TOOLS`.                                                   |

##### DATASOURCE_CREDENTIALS

The `DATASOURCE_CREDENTIALS` environment variable is a JSON string that includes usernames and
passwords for any datasources that require them. The format is:

`{"ds-luid1":[{"luid":"ds1-connection-luid1","u":"username1","p":"password1"},{"luid":"ds1-connection-luid2","u":"username2","p":"password2"}],"ds-luid2":[{"luid":"ds2-connection-luid1","u":"username3","p":"password3"}]}`

This is a JSON-stringified version of the following object:

```js
{
  "ds-luid1": [
    { luid: "ds1-connection-luid1", u: "username1", p: "password1" },
    { luid: "ds1-connection-luid2", u: "username2", p: "password2" }
  ],
  "ds-luid2": [
    { luid: "ds2-connection-luid1", u: "username3", p: "password3" }
  ]
}
```

The connection LUIDs can be determined using the
[Query Data Source Connections REST API](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_source_connections).
Future work will include a tool to automate this process. For more information, see
[Connect to your data source](https://help.tableau.com/current/api/vizql-data-service/en-us/docs/vds_create_queries.html#connect-to-your-data-source).

### Running the MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a helpful tool to confirm
your configuration is correct and to explore Tableau MCP capabilities.

Create a `config.json` file in the root of the project using `config.example.json` as a template.
(Docker users can skip this step.)

After building the project and setting the environment variables in the `env.list` file, you can
start the MCP Inspector using either of the following commands:

| **Command**              | **Description**                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `npm run inspect`        | Start the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) which runs the server locally using Node.js.    |
| `npm run inspect:docker` | Start the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) which runs the server using a Docker container. |

### Claude Desktop

For Claude, open the settings dialog, select the **Developer** section, and click **Edit Config**.

Add the `tableau` MCP server to the `mcpServers` object in the config using `config.example.json` or
`config.docker.json` as a template.

### Cursor

TODO

### VSCode

TODO

## Developers

### Contributing

We are following the
[fork and pull model](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/getting-started/about-collaborative-development-models)
where contributors will make their own fork of this repo, implement their changes, and then submit a
pull request here.

Refer to the [Contribution Checklist](CONTRIBUTING.md#contribution-checklist) for more details on
the steps.

### Debugging

You can use the
[VS Code Run and Debug Launcher](https://code.visualstudio.com/docs/debugtest/debugging#_start-a-debugging-session)
to run and debug the server.

To set up local debugging with breakpoints:

1. Store your environment variables in the VS Code user settings:

   - Open the Command Palette (F1 or Cmd/Ctrl + Shift + P).
   - Type `Preferences: Open User Settings (JSON)`.
   - This should open your user's `settings.json` file.
   - Copy the environment variables from `.vscode/settings.example.json`, append them to the JSON
     blob in your user's `settings.json` file, and update their values accordingly:

     ```
     "tableau.mcp.SERVER": "https://my-tableau-server.com",
     ...
     ```

2. Set breakpoints in your TypeScript files.
3. Locate and click the `Run and Debug` button in the Activity Bar.
4. Select the configuration labeled "`Launch MCP Server`" in the dropdown.
5. Click the Start Debugging ▶️ button, or press F5.

[query]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_sources
[meta]: https://help.tableau.com/current/api/metadata_api/en-us/index.html
[vds]: https://help.tableau.com/current/api/vizql-data-service/en-us/index.html
[pat]: https://help.tableau.com/current/server/en-us/security_personal_access_tokens.htm
