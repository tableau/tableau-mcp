---
sidebar_position: 1
---

# Environment Variables

Values for the following environment variables can be provided to configure the Tableau MCP server.

## `SERVER`

The URL of the Tableau server.

- For Tableau Cloud, specify your site's specific pod e.g.
  `https://prod-useast-c.online.tableau.com`
- Required unless [`AUTH`](#auth) is `oauth`.

<hr />

## `SITE_NAME`

The name of the Tableau site to use.

- For Tableau Cloud, specify your site name.
- For Tableau Server, you may leave this value blank to use the default site.
- Required unless [`AUTH`](#auth) is `oauth`.

<hr />

## `TRANSPORT`

The MCP transport type to use for the server.

- Default: `stdio`
- Possible values: `stdio` or `http`
- For `http`, see [HTTP Server Configuration](http-server.md) for additional variables.
- See [MCP Transports][mcp-transport] for details.

<hr />

## `AUTH`

The method the MCP server uses to authenticate to the Tableau REST APIs.

- Default: `pat`
- Possible values: `pat`, `direct-trust`, or `oauth`
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
  - `username`: For tool calls, the username of the user who made the call. This is only present
    when OAuth is enabled and has the user context.
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

## `MAX_REQUEST_TIMEOUT_MS`

The maximum timeout for requests to the Tableau Server REST API.

- Default: `600000` (10 minutes)
- Must be a positive number between `5000` (5 seconds) and `3600000` (1 hour).

<hr />

## `MAX_RESULT_LIMIT`

The maximum number of results that every tool with a `limit` parameter can return when no
tool-specific max result limit is set in the [`MAX_RESULT_LIMITS`](#max_result_limits) environment
variable.

:::warning

Take care when setting this value and be sure to set appropriate tool-specific limits in the
[`MAX_RESULT_LIMITS`](#max_result_limits) environment variable.

:::

- Default: Empty string (_no limit_)
- Must be a positive number.

<hr />

## `MAX_RESULT_LIMITS`

A comma-separated list of tool names (or tool group names) and the maximum number of results that
each tool (or tools in the group) can return.

:::info

Example:

```
MAX_RESULT_LIMIT=30
MAX_RESULT_LIMITS=query-datasource:1000,list-datasources:20
```

This means that:

- The `query-datasource` tool can return up to 1000 results.
- The `list-datasources` tool can return up to 20 data sources.
- Every other tool is limited to 30 results.

:::

- Default: Empty string (_no limits_)
- For a list of available tools and groups, see
  [toolName.ts](https://github.com/tableau/tableau-mcp/blob/main/src/tools/toolName.ts).
- Only applies to tools that have a `limit` parameter and return an array of items.
- Tool names take precedence over tool group names. That is, `datasource:1000,list-datasources:20`
  means that the `list-datasources` tool can return up to 20 data sources but the `query-datasource`
  tool can only return up to 1000 results.
- If a tool-specific limit is not set, the global limit specified by the
  [`MAX_RESULT_LIMIT`](#max_result_limit) environment variable will be used instead.
- Each limit must be a positive number.

<hr />

## `DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS`

Disables requests that are made to the VizQl Data Service for validating queries in the
[`query-datasource`](../../tools/data-qna/query-datasource.md) tool. Does not disable the ability to
query the datasource.

- Default: `false`
- When `true`, skips validation of queries against metadata results and validation of SET and MATCH
  filters.

<hr />

## `DISABLE_QUERY_DATASOURCE_FILTER_VALIDATION`

Note: This environment variable was deprecated in Tableau MCP `v1.13.0` and replaced by
`DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS`.

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

## `DISABLE_SESSION_MANAGEMENT`

When `false` (the default) and using the Streamable HTTP transport, the MCP server will create and
manage sessions as per the
[Session Management](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#session-management)
section of the MCP spec. The only state persisted in the session from one request to another is
information about the client's identity, capabilities, and protocol version compatibility.

- Default: `false`
- Does not apply to the stdio transport.
- When `true`, the MCP server will no longer assign a session ID at initialization time nor require
  clients to provide that session ID in the `mcp-session-id` header for subsequent requests.
- Set this to `true` if you are using the HTTP transport and your client does not support or need
  session management.

<hr />

## `TABLEAU_SERVER_VERSION_CHECK_INTERVAL_IN_HOURS`

Some tools may have behavior or arguments that depend on the Tableau Server or Cloud version the MCP
server is connected to. Rather than checking the Tableau version with every request, the MCP server
will cache the version and only check it again after the interval specified by this environment
variable.

- Default: `1` hour
- Must be a positive number between `1` and `168` (7 days).

<hr />

## `TELEMETRY_PROVIDER`

The telemetry provider to use for metrics collection.

- Default: `noop`
- Possible values:
  - `noop` - No telemetry (default)
  - `custom` - Use a custom telemetry provider (requires
    [`TELEMETRY_PROVIDER_CONFIG`](#telemetry_provider_config))

<hr />

## `TELEMETRY_PROVIDER_CONFIG`

Configuration for the custom telemetry provider. Required when
[`TELEMETRY_PROVIDER`](#telemetry_provider) is `custom`.

- Format: JSON string with at least a `module` field
- The `module` field should be a path to a JavaScript file or npm package that exports a class
  implementing the `TelemetryProvider` interface.

**Example:**

```bash
TELEMETRY_PROVIDER_CONFIG='{"module": "./my-telemetry-provider.js"}'
```

The custom provider module should export a default class (or named export `TelemetryProvider`) that
implements:

```typescript
interface TelemetryProvider {
  initialize(): void;
  recordMetric(name: string, value: number, attributes: Record<string, unknown>): void;
}
```

<hr />

## `PRODUCT_TELEMETRY_ENABLED`

Enables product telemetry for tool usage tracking.

- Default: `true`
- When `true`, the server will send telemetry events to Tableau's telemetry endpoint for each tool
  call, including tool name, request ID, session ID, and site name.
- Set to `false` to disable product telemetry.

[mcp-transport]: https://modelcontextprotocol.io/docs/concepts/transports
[tab-ds-connections]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_source_connections
[tab-connect-ds]:
  https://help.tableau.com/current/api/vizql-data-service/en-us/docs/vds_create_queries.html#connect-to-your-data-source
