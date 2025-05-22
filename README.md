# Tableau MCP

[![Tableau Supported](https://img.shields.io/badge/Support%20Level-Tableau%20Supported-53bd92.svg)](https://www.tableau.com/support-levels-it-and-developer-tools)

Tableau MCP is a suite of developer primitives, including tools, resources and prompts, that will
make it easier for developers to build AI-applications that integrate with Tableau.

## Getting Started

### Contributors

1. Clone the repository
2. Install [Node.js](https://nodejs.org/en/download) (tested with 22.15.0 LTS)
3. `npm install`
4. `npm run build`

### Docker users who just want to run the server

```bash
docker build -t tableau-mcp .
```

## Environment Variables

- Docker users should create an `env.list` file in the root of the project using `env.example.list`
  as a template.

- If you are using [MCP Inspector](https://github.com/modelcontextprotocol/inspector), create a
  `config.json` file in the root of the project using `config.example.json` as a template. Docker
  users can skip this step.

- If you are using Claude or other client, add the `tableau` MCP server to the `mcpServers` object
  in the config using `config.example.json` or `config.docker.json` as a template. For Claude, open
  the settings dialog, select the **Developer** section, and click **Edit Config**.

### Required Environment Variables

| **Variable**      | **Description**                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `SERVER`          | The URL of the Tableau server.                                                                                                                 |
| `SITE_NAME`       | The name of the Tableau site to use. For Tableau Server, to specify the default site, set this to an empty string.                             |
| _Credentials_     | The credentials to use to authenticate to the Tableau server. See [Tableau Authentication](#tableau-authentication) section.                   |

### Optional Environment Variables

| **Variable**          | **Description**                                                                                     | **Default**                        | **Note**                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| `DEFAULT_LOG_LEVEL`   | The default logging level of the server.                                                            | `debug`                            |                                                                          |
| `DISABLE_LOG_MASKING` | Disable masking of credentials in logs. For debug purposes only.                                    | `false`                            |                                                                          |
| `INCLUDE_TOOLS`       | A comma-separated list of tool names to include in the server. Only these tools will be available.  | Empty string (_all_ are included)  | For a list of available tools, see [toolName.ts](src/tools/toolName.ts). |
| `EXCLUDE_TOOLS`       | A comma-separated list of tool names to exclude from the server. All other tools will be available. | Empty string (_none_ are excluded) | Cannot be provided with `INCLUDE_TOOLS`.                                 |

## Tableau Authentication

The MCP server tools call into various Tableau APIs, including
[VizQL Data Service](https://help.tableau.com/current/api/vizql-data-service/en-us/index.html) and
the [Metadata API](https://help.tableau.com/current/api/metadata_api/en-us/index.html). To
authenticate to these APIs, you must provide your credentials via environment variables.

> 💡 When multiple credentials are provided, the order in which the below authentication methods are
> listed is also the order of precedence used by the server. Provide the `AUTH_TYPE` environment
> variable to specify which authentication method to use. Allowed values are `pat`, `jwt`,
> `direct-trust`, and `username-password`.

### Personal Access Token (PAT)

If you have a
[personal access token](https://help.tableau.com/current/server/en-us/security_personal_access_tokens.htm),
you can use it by setting the `PAT_NAME` and `PAT_VALUE` environment variables.

### JSON Web Token (JWT)

If you have a JWT generated using a
[Direct Trust Connected App](https://help.tableau.com/current/online/en-us/connected_apps_direct.htm#step-3-configure-the-jwt),
you can use it by setting the `JWT` environment variable.

> ⚠️ Required scopes are:
>
> - `tableau:viz_data_service:read`
> - `tableau:content:read`

### Connected App

If you have a
[Direct Trust Connected App](https://help.tableau.com/current/online/en-us/connected_apps_direct.htm#create-a-connected-app),
you can provide its details and the MCP server will generate the JWT for you. Set these environment
variables:

| **Variable**                 | **Description**                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `USERNAME`                   | The username of the user you want to authenticate as.                                                                            |
| `CONNECTED_APP_CLIENT_ID`    | The client ID of the connected app.                                                                                              |
| `CONNECTED_APP_SECRET_ID`    | The secret ID of the connected app.                                                                                              |
| `CONNECTED_APP_SECRET_VALUE` | The secret value of the connected app.                                                                                           |
| `JWT_SCOPES`                 | The comma-separated scopes you want to add to the JWT in addition to `tableau:viz_data_service:read` and `tableau:content:read`. |

### Username/Password

If you have a username and password, you can use them by setting the `USERNAME` and `PASSWORD`
environment variables.

## Running the MCP Server

After building the project and setting the environment variables, you can start the MCP server using
the following commands:

| **Command**              | **Description**                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `npm run inspect`        | Start the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) which runs the server locally using Node.js.    |
| `npm run inspect:docker` | Start the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) which runs the server using a Docker container. |

## Debugging

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
