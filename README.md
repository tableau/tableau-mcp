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
- Supports access to Pulse Metric, Pulse Metric Definitions, Pulse Subscriptions, and Pulse Metric
  Value Insight Bundle through the [Pulse API][pulse]
- Usable by AI tools which support MCP Tools (e.g., Claude Desktop, Cursor and others)
- Works with any published data source on either Tableau Cloud or Tableau Server

The following MCP tools are currently implemented:

| **Variable**                                      | **Description**                                                                                |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| list-datasources                                  | Retrieves a list of published data sources from a specified Tableau site ([REST API][query])   |
| list-fields                                       | Fetches field metadata (name, description) for the specified datasource ([Metadata API][meta]) |
| query-datasource                                  | Run a Tableau VizQL query ([VDS API][vds])                                                     |
| read-metadata                                     | Requests metadata for the specified data source ([VDS API][vds])                               |
| list-all-pulse-metric-definitions                 | List All Pulse Metric Definitions ([Pulse API][pulse])                                         |
| list-pulse-metric-definitions-from-definition-ids | List Pulse Metric Definitions from Metric Definition IDs ([Pulse API][pulse])                  |
| list-pulse-metrics-from-metric-definition-id      | List Pulse Metrics from Metric Definition ID ([Pulse API][pulse])                              |
| list-pulse-metrics-from-metric-ids                | List Pulse Metrics from Metric IDs ([Pulse API][pulse])                                        |
| list-pulse-metric-subscriptions                   | List Pulse Metric Subscriptions for Current User ([Pulse API][pulse])                          |
| generate-pulse-metric-value-insight-bundle        | Generate Pulse Metric Value Insight Bundle ([Pulse API][pulse])                                |

Note: The Tableau MCP project is currently in early development. As we continue to enhance and
refine the implementation, the available functionality and tools may evolve. We welcome feedback and
contributions to help shape the future of this project.

## Getting Started

### Install Prerequisites

Follow these steps to install Tableau MCP for the first time:

1. Clone the repository
2. Install [Node.js >= 22.7.5](https://nodejs.org/en/download) (tested with 22.15.0 LTS)
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
- You may need to
  [enable Tableau Pulse](https://help.tableau.com/current/online/en-us/pulse_set_up.htm) on your
  Tableau Cloud site to use [Pulse API][pulse] tools (Tableau Server is unable to use Tableau Pulse)

## Tableau Authentication

Tableau MCP requires authentication in order to connect with your Tableau Server or Tableau Cloud
site. This authenticated user must have access to the published data source(s) you plan to access.

There are several ways to authenticate to Tableau. See
[Environment Variables](#environment-variables) for more information.:

1. Provide your Tableau [Personal Access Token][pat] by setting the `PAT_NAME` and `PAT_VALUE`
   environment variables.
2. Use Tableau Connected Apps by setting the `AUTH` environment variable to `direct-trust`. See
   [Direct Trust Configuration](#direct-trust-configuration) for additional required configuration.
3. Use Tableau OAuth by setting the `AUTH` environment variable to `oauth`. See
   [OAuth Configuration](#oauth-configuration) for additional required configuration.

## Configuring AI Tools

AI tools can connect to Tableau MCP in two different ways:

- Running locally: the tool runs Tableau MCP as needed using `node build/index.js`
- Running in Docker: the tool runs Tableau MCP as a Docker container

Either method will work. The Docker path is slightly easier because all the environment variables
are stored in one file rather than in each AI tool's config section.

### Environment Variables

All environment variables specified in a `.env` file will be available to the MCP server. Creating a
`.env` file is not required though since environment variables can also be provided by AI tools via
their MCP configuration or to the Docker container running the MCP server via `env.list` file.

Depending on your desired mode, create your environment configuration as follows:

For **running locally**, create an `mcpServers` JSON snippet using `config.stdio.json` or
`config.http.json` as a template, depending on your desired transport type. For `stdio` transport,
it should look similar to this:

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

| **Variable** | **Description**                                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `SERVER`     | The URL of the Tableau server. For Tableau Cloud, specify your site's specific pod e.g. `https://prod-useast-c.online.tableau.com` |
| `SITE_NAME`  | The name of the Tableau site to use. For Tableau Server, set this to an empty string to specify the default site.                  |

#### Optional Environment Variables

| **Variable**                                 | **Description**                                                                                     | **Default**                        | **Note**                                                                                                                                                                                    |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TRANSPORT`                                  | The MCP transport type to use for the server.                                                       | `stdio`                            | Possible values are `stdio` or `http`. For `http`, see [HTTP Server Configuration](#http-server-configuration) below for additional variables. See [Transports][mcp-transport] for details. |
| `AUTH`                                       | The authentication method to use by the server.                                                     | `pat`                              | Possible values are `pat`, `direct-trust`, or `oauth`. See below sections for additional required variables depending on the desired method.                                                |
| `DEFAULT_LOG_LEVEL`                          | The default logging level of the server.                                                            | `debug`                            |                                                                                                                                                                                             |
| `DATASOURCE_CREDENTIALS`                     | A JSON string that includes usernames and passwords for any datasources that require them.          |                                    | Format is provided in the [DATASOURCE_CREDENTIALS](#datasource_credentials) section below.                                                                                                  |
| `DISABLE_LOG_MASKING`                        | Disable masking of credentials in logs. For debug purposes only.                                    | `false`                            |                                                                                                                                                                                             |
| `INCLUDE_TOOLS`                              | A comma-separated list of tool names to include in the server. Only these tools will be available.  | Empty string (_all_ are included)  | For a list of available tools, see [toolName.ts](src/tools/toolName.ts).                                                                                                                    |
| `EXCLUDE_TOOLS`                              | A comma-separated list of tool names to exclude from the server. All other tools will be available. | Empty string (_none_ are excluded) | Cannot be provided with `INCLUDE_TOOLS`.                                                                                                                                                    |
| `MAX_RESULT_LIMIT`                           | If a tool has a "limit" parameter and returns an array of items, the maximum length of that array.  | Empty string (_no limit_)          | A positive number.                                                                                                                                                                          |
| `DISABLE_QUERY_DATASOURCE_FILTER_VALIDATION` | Disable validation of SET and MATCH filter values in query-datasource tool.                         | `false`                            | When `true`, skips validation that checks if filter values exist in the target field.                                                                                                       |

#### HTTP Server Configuration

When `TRANSPORT` is `http`, below are the additional, optional environment variables that can be
used to configure the HTTP server.

| **Variable**                      | **Description**                                                  | **Default** | **Notes**                                                                                                               |
| --------------------------------- | ---------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `HTTP_PORT_ENV_VAR_NAME`          | The environment variable name to use for the HTTP server port.   | `PORT`      |                                                                                                                         |
| _Value of HTTP_PORT_ENV_VAR_NAME_ | The port to use for the HTTP server.                             | 3927        |                                                                                                                         |
| `SSL_KEY`                         | The path to the SSL key file to use for the HTTP server.         |             |                                                                                                                         |
| `SSL_CERT`                        | The path to the SSL certificate file to use for the HTTP server. |             |                                                                                                                         |
| `CORS_ORIGIN_CONFIG`              | The origin or origins to allow CORS requests from.               | `true`      | Acceptable values include `true`, `false`, `*`, or a URL or array of URLs. See [cors config options][cors] for details. |

#### Personal Access Token Configuration

When `AUTH` is `pat`, the following environment variables are required:

| **Variable** | **Description**                                                                  |
| ------------ | -------------------------------------------------------------------------------- |
| `PAT_NAME`   | The name of the Tableau [Personal Access Token][pat] to use for authentication.  |
| `PAT_VALUE`  | The value of the Tableau [Personal Access Token][pat] to use for authentication. |

#### Direct Trust Configuration

When `AUTH` is `direct-trust`, the MCP server will use the provided Tableau Direct Trust Connected
App info to generate a scoped [JSON Web Token (JWT)][direct-trust] and use it to authenticate to
authenticate to the Tableau REST APIs. The generated JWT will have the minimum set of scopes
necessary to invoke the methods called by the tool being executed. For example, for the
`query-datasource` tool, since it internally calls into VizQL Data Service, the JWT will only have
the `tableau:viz_data_service:read` scope.

The following environment variables are required:

| **Variable**                 | **Description**                                | **Notes**                                                                                       |
| ---------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `JWT_SUB_CLAIM`              | The username for the `sub` claim of the JWT.   | Can either be a hard-coded username, or the OAuth username by setting it to `{OAUTH_USERNAME}`. |
| `CONNECTED_APP_CLIENT_ID`    | The client ID of the Tableau Connected App.    |                                                                                                 |
| `CONNECTED_APP_SECRET_ID`    | The secret ID of the Tableau Connected App.    |                                                                                                 |
| `CONNECTED_APP_SECRET_VALUE` | The secret value of the Tableau Connected App. |                                                                                                 |

The optional `JWT_ADDITIONAL_PAYLOAD` environment variable is a JSON string that includes any
additional user attributes to include on the JWT. It also supports dynamically including the OAuth
username. The following is an example:

```json
{ "username": "{OAUTH_USERNAME}", "region": "West" }
```

#### OAuth Configuration

When a URL for `OAUTH_ISSUER` is provided, the MCP server will require logging in via Tableau OAuth
to access. If `AUTH` is `oauth`, then `OAUTH_ISSUER` is required. The following environment
variables will also apply or have additional meaning:

| **Variable**                          | **Description**                                     | **Default**               | **Notes**                                                                                                                                                                                                |
| ------------------------------------- | --------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OAUTH_ISSUER`                        | The issuer of the OAuth server.                     |                           | Required if `AUTH` is `oauth`. For testing, use `http://127.0.0.1:3927`                                                                                                                                  |
| `TRANSPORT`                           | The MCP transport type to use for the server.       | `http`                    | Must be `http` when OAuth is enabled. Also defaults to `http` if not provided.                                                                                                                           |
| `SITE_NAME`                           | The target Tableau site for OAuth.                  |                           | Not required if `AUTH` is `oauth` and users will see the site picker if they have access to multiple sites. Choosing a site from a Cloud pod different from the one specified in `SERVER` will not work. |
| `OAUTH_REDIRECT_URI`                  | The redirect URI for the OAuth flow.                | `{OAUTH_ISSUER}/Callback` |                                                                                                                                                                                                          |
| `OAUTH_JWT_SECRET`                    | The symmetric secret to sign the access token with. |                           | Required. See [jose SignJWT docs][sign-jwt] for details.                                                                                                                                                 |
| `OAUTH_AUTHORIZATION_CODE_TIMEOUT_MS` | The timeout for the OAuth authorization codes.      | _10 seconds_              | Max: 1 hour.                                                                                                                                                                                             |
| `OAUTH_ACCESS_TOKEN_TIMEOUT_MS`       | The timeout for the OAuth access tokens.            | _24 hours_                | Max: 30 days.                                                                                                                                                                                            |
| `OAUTH_REFRESH_TOKEN_TIMEOUT_MS`      | The timeout for the OAuth refresh tokens.           | _30 days_                 | Max: 1 year.                                                                                                                                                                                             |

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

### Claude Desktop

For Claude, open the settings dialog, select the **Developer** section, and click **Edit Config**.

Add the `tableau` MCP server to the `mcpServers` object in the config using `config.stdio.json`,
`config.http.json`, or `config.docker.json` as a template.

### Cursor

For Cursor, create a configuration file `.cursor/mcp.json` in your project directory (for
project-specific access) or `~/.cursor/mcp.json` in your home directory (for global access across
all projects).

Add the `tableau` MCP server configuration using `config.stdio.json`, `config.http.json`, or
`config.docker.json` as a template. For more details, see the
[Cursor MCP documentation](https://docs.cursor.com/context/model-context-protocol).

| Type   | Install link                                                                                                                                                                                                                                                                                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node   | [![Install MCP Server](https://cursor.com/deeplink/mcp-install-light.svg)](https://cursor.com/install-mcp?name=tableau&config=eyJjb21tYW5kIjoibm9kZSAvZnVsbC1wYXRoLXRvLXRhYmxlYXUtbWNwL2J1aWxkL2luZGV4LmpzIiwiZW52Ijp7IlNFUlZFUiI6Imh0dHBzOi8vbXktdGFibGVhdS1zZXJ2ZXIuY29tIiwiU0lURV9OQU1FIjoiIiwiUEFUX05BTUUiOiIiLCJQQVRfVkFMVUUiOiIifX0%3D) |
| Docker | [![Install MCP Server](https://cursor.com/deeplink/mcp-install-light.svg)](https://cursor.com/install-mcp?name=tableau&config=eyJjb21tYW5kIjoiZG9ja2VyIHJ1biAtaSAtLXJtIC0tZW52LWZpbGUgcGF0aC90by9lbnYubGlzdCB0YWJsZWF1LW1jcCJ9)                                                                                                               |

### VSCode

For VSCode, create a `.vscode/mcp.json` file in your workspace folder (for project-specific access)
or add the server configuration to your user settings (for global access across all workspaces).

Add the `tableau` MCP server configuration using `config.stdio.json`, `config.http.json`, or
`config.docker.json` as a template. For more details, see the
[VSCode MCP documentation](https://code.visualstudio.com/docs/copilot/chat/mcp-servers).

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
[pulse]: https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_pulse.htm
[mcp-inspector]: https://github.com/modelcontextprotocol/inspector
[mcp-transport]: https://modelcontextprotocol.io/docs/concepts/transports
[express]: https://expressjs.com/
[cors]: https://expressjs.com/en/resources/middleware/cors.html#configuration-options
[sign-jwt]: https://github.com/panva/jose/blob/main/docs/jwt/sign/classes/SignJWT.md#examples
[direct-trust]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_authentication.htm#jwt
