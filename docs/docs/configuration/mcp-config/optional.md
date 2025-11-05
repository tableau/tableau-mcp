---
sidebar_position: 2
---

# Optional Environment Variables

Values for the following environment variables are optional.

## `TRANSPORT`

The MCP transport type to use for the server.

- Default: `stdio`
- Possible values: `stdio` or `http`
- For `http`, see [HTTP Server Configuration](http-server.md) for additional variables.
- See [MCP Transports][mcp-transport] for details.

<hr />

## `AUTH`

The Tableau authentication method to use by the server.

- Default: `pat`
- Possible values: `pat` or `direct-trust`
- See [Authentication](authentication) for additional required variables depending on the desired
  method.

<hr />

## `ENABLE_SERVER_LOGGING`

When `true`, the server will continue sending notifications to MCP clients, but will now also write
them to local files in the directory specified in the
[`SERVER_LOG_DIRECTORY`](#server_log_directory) environment variable. Notifications include tool
calls and their arguments as well as HTTP traces for the requests and responses to the Tableau REST
APIs.

- Default: `false`
- The log file names are in the format `YYYY-MM-DDTHH-00-00-000Z.log` e.g.
  `2025-10-15T22-00-00-000Z.log` meaning this log file contains all log messages for hour 22 of
  2025-10-15 in UTC time. All log entries for a given hour of the day are appended to the same file.
- Each line in the log file is a JSON object with the following properties:

  - `timestamp`: The timestamp of the log message in UTC time.
  - `level`: The logging level of the log message.
  - `logger`: The logger of the log message. This is typically `rest-api` for HTTP traces or
    `tableau-mcp` for tool calls.
  - `message`: The log message itself. This may be a string or a JSON object.

- All notifications are written to the local log files regardless of the server's currently
  configured minimum logging level, since that only applies to notifications sent to MCP clients.
  See [`DEFAULT_LOG_LEVEL`](#default_log_level) for more information.
- Secrets are masked by default in the log files. To reveal them for debugging purposes, set the
  [`DISABLE_LOG_MASKING`](#disable_log_masking) environment variable to `true`.

<hr />

## `SERVER_LOG_DIRECTORY`

The directory server logs are written to when [`ENABLE_SERVER_LOGGING`](#enable_server_logging) is
`true`.

- Default: `[build directory]/logs` i.e. `build/logs`.
- The server will attempt to create the directory if it does not exist.
- There is no cleanup of old log files. The server will continue to create log files indefinitely.

<hr />

## `DEFAULT_LOG_LEVEL`

The default logging level of the server.

- Default: `debug`
- Possible values:
  - `debug`
  - `info`
  - `notice`
  - `warning`
  - `error`
  - `critical`
  - `alert`
  - `emergency`

This value determines the minimum log level in which to send notifications to MCP clients. That is,
if the server's currently configured minimum logging level is `debug`, all log messages will be sent
to MCP clients. If the level is set to `error`, only log messages with a level of `error` or higher
will be sent. Note that MCP clients can
[change the minimum log level](https://modelcontextprotocol.io/specification/2025-06-18/server/utilities/logging#setting-log-level)
any time they want.

<hr />

## `DISABLE_LOG_MASKING`

Disable masking of credentials in MCP client notifications and server logs. For debug purposes only.

- Default: `false`

<hr />

## `DATASOURCE_CREDENTIALS`

A JSON string that includes usernames and passwords for any datasources that require them.

The format is:

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

The connection LUIDs can be determined using the [Query Data Source Connections REST
API][tab-ds-connections].

Future work will include a tool to automate this process. For more information, see [Connect to your
data source][tab-connect-ds].

<hr />

## `INCLUDE_TOOLS`

A comma-separated list of tool or tool group names to include in the server. Only these tools will
be available.

- Default: Empty string (_all_ are included)
- For a list of available tools and groups, see
  [toolName.ts](https://github.com/tableau/tableau-mcp/blob/main/src/tools/toolName.ts).
- Mixing tool names and group names is allowed.

<hr />

## `EXCLUDE_TOOLS`

A comma-separated list of tool or tool group names to exclude from the server. All other tools will
be available.

- Default: Empty string (_none_ are excluded)
- Cannot be provided with `INCLUDE_TOOLS`.

<hr />

## `MAX_RESULT_LIMIT`

If a tool has a `limit` parameter and returns an array of items, the maximum length of that array.

- Default: Empty string (_no limit_)
- Must be a positive number.

<hr />

## `DISABLE_QUERY_DATASOURCE_FILTER_VALIDATION`

Disable validation of SET and MATCH filter values in the
[`query-datasource`](../../tools/data-qna/query-datasource.md) tool.

- Default: `false`
- When `true`, skips the validation that checks if filter values exist in the target field.

<hr />

## `DISABLE_METADATA_API_REQUESTS`

Disables `graphql` requests to the Tableau Metadata API in the
[`get-datasource-metadata`](../../tools/data-qna/get-datasource-metadata.md) tool.

- Default: `false`
- When `true`, skips requests to the `graphql` endpoint that provides additional context to field
  metadata.
- Set this to `true` if you are using the
  [`get-datasource-metadata`](../../tools/data-qna/get-datasource-metadata.md) tool and the Tableau
  Metadata API is not enabled on your Tableau Server.

<hr />

[mcp-transport]: https://modelcontextprotocol.io/docs/concepts/transports
[tab-ds-connections]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_source_connections
[tab-connect-ds]:
  https://help.tableau.com/current/api/vizql-data-service/en-us/docs/vds_create_queries.html#connect-to-your-data-source
