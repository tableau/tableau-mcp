# tableau-mcp

## Getting Started

1. Clone the repository
2. Install [Node.js](https://nodejs.org/en/download) (tested with 22.15.0 LTS)
3. `npm install`
4. `npm run build`

## Environment Variables

- If you are running the server standalone, create an `.env` file in the root of the project using
  `.example.env` as a template.

- If you are using [MCP Inspector](https://github.com/modelcontextprotocol/inspector), create a
  `config.json` file in the root of the project using `config.example.json` as a template.

- If you are using Claude or other client, add the `tableau` MCP server to the `mcpServers` object
  in the config using `config.example.json` as a template. For Claude, open the settings dialog,
  select the **Developer** section, and click **Edit Config**.

  ```json
  {
    "mcpServers": {
      "tableau": {
        "command": "node",
        "args": ["C:\\path\\to\\tableau-mcp\\build\\index.js"],
        "env": {
          "SERVER": "https://my-tableau-server.com",
          ...
        }
      }
    }
  }
  ```

### Required Environment Variables

| **Variable**      | **Description**                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `SERVER`          | The URL of the Tableau server.                                                                                                                 |
| `SITE_NAME`       | The name of the Tableau site to use.                                                                                                           |
| `DATASOURCE_LUID` | The LUID of the datasource to use. To find it, navigate to the datasource in Tableau Server under the `Explore` tab and click the info icon 🛈. |
| _Credentials_     | The credentials to use to authenticate to the Tableau server. See [Tableau Authentication](#tableau-authentication) section.                   |

### Optional Environment Variables

| **Variable**          | **Description**                                                                   |
| --------------------- | --------------------------------------------------------------------------------- |
| `DEFAULT_LOG_LEVEL`   | The default logging level of the server. Default: `debug`                         |
| `DISABLE_LOG_MASKING` | Disable masking of credentials in logs. For debug purposes only. Default: `false` |

## Tableau Authentication

The MCP server tools call into various Tableau APIs, including
[VizQL Data Service](https://help.tableau.com/current/api/vizql-data-service/en-us/index.html) and
the [Metadata API](https://help.tableau.com/current/api/metadata_api/en-us/index.html). To
authenticate to these APIs, you must provide your credentials via environment variables.

> 💡 When multiple credentials are provided, the order in which the below authentication methods are
> listed is also the order of precedence used by the server. Provide the `AUTH_TYPE` environment
> variable to specify which authentication method to use. Allowed values are `pat`, `jwt`,
> `connected-app`, and `username-password`.

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
> - `tableau:content:read`.

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

| **Command**       | **Description**                                                              |
| ----------------- | ---------------------------------------------------------------------------- |
| `npm run inspect` | Start the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) |
| `npm run start`   | Start the standalone MCP server                                              |
