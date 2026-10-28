---
sidebar_position: 1
---

# Environment Variables

Values for the following environment variables can be provided to configure the Tableau MCP server.

## `SERVER`

The URL of the Tableau server.

- For Tableau Cloud, specify your site's specific pod e.g.
  `https://prod-useast-c.online.tableau.com`

<hr />

## `SITE_NAME`

The Content URL of the Tableau site to use. This may differ from the site's display name (e.g.,
Content URL `Internal` vs display name `[INTERNAL] My Company`).

- For Tableau Cloud, specify your site's Content URL.
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
- Possible values: `pat`, `direct-trust`, `oauth`, or `passthrough`
- See [Authentication](authentication) for additional required variables depending on the desired
  method.
- Setting `passthrough` implies
  [`ENABLE_PASSTHROUGH_AUTH`](authentication/passthrough.md#enable_passthrough_auth) is `true`,
  requires `TRANSPORT=http`, and requires every request to carry a token in the `X-Tableau-Auth`
  header or the `workgroup_session_id` cookie (there is no fallback auth method).
  OAuth stays disabled in this mode, even when `OAUTH_ISSUER` is set. See
  [Passthrough Authentication](authentication/passthrough).

<hr />

## `ENABLED_LOGGERS`

A comma-separated list of loggers to enable.

- Default: `appLogger`
- Possible values (may be combined): `fileLogger`, `appLogger`
  - `fileLogger` — writes log entries and MCP notifications normally only sent to clients to hourly
    rotating files in the directory specified by[`FILE_LOGGER_DIRECTORY`](#file_logger_directory).
    Notifications include tool calls and their arguments as well as HTTP traces for the requests and
    responses to the Tableau REST APIs.
  - `appLogger` — writes log entries to stdout as JSON. Enabled by default when transport is `http`.
- The log file names are in the format `YYYY-MM-DDTHH-00-00-000Z.log` e.g.
  `2025-10-15T22-00-00-000Z.log` meaning this log file contains all log messages for hour 22 of
  2025-10-15 in UTC time. All log entries for a given hour of the day are appended to the same file.
- Each line in the log file is a JSON object with a timestamp and additional properties:
  - `timestamp`: The timestamp of the log message in UTC time.
  - `level`: The logging level of the log message.
  - `logger`: The logger of the log message. This is typically `rest-api` for HTTP traces or
    `tableau-mcp` for tool calls.
  - `message`: The log message itself. This may be a string or a JSON object.

- All notifications are written to the local log files regardless of the notification level, since
  [`DEFAULT_NOTIFICATION_LEVEL`](#default_notification_level) only applies to notifications sent to
  MCP clients. Server log output (stderr/console) is controlled separately by
  [`LOG_LEVEL`](#log_level).
- Secrets are masked by default in the log files. To reveal them for debugging purposes, set the
  [`DISABLE_LOG_MASKING`](#disable_log_masking) environment variable to `true`.

<hr />

## `FILE_LOGGER_DIRECTORY`

The directory server logs are written to when [`ENABLED_LOGGERS`](#enabled_loggers) includes
`fileLogger`.

- Default: `[build directory]/logs` i.e. `build/logs`.
- The server will attempt to create the directory if it does not exist.
- There is no cleanup of old log files. The server will continue to create log files indefinitely.

<hr />

## `DEFAULT_NOTIFICATION_LEVEL`

The default minimum level for sending notifications to MCP clients.

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

This value determines the minimum level at which to send notifications to MCP clients. That is, if
set to `debug`, all notifications will be sent. If set to `error`, only notifications with a level
of `error` or higher will be sent. Note that MCP clients can
[change the minimum level](https://modelcontextprotocol.io/specification/2025-11-25/server/utilities/logging#setting-log-level)
any time they want.

Note: this variable was named DEFAULT_LOG_LEVEL until version 2.0.0

<hr />

## `LOG_LEVEL`

The minimum severity level for server log output (stderr on stdio transport, console on http
transport, and file logger).

- Default: `info`
- Possible values:
  - `debug` — all log entries
  - `info`
  - `notice`
  - `warning`
  - `error`
  - `critical`
  - `alert`
  - `emergency`

Log entries with a level below the configured value are silently dropped. This is independent of
[`DEFAULT_NOTIFICATION_LEVEL`](#default_notification_level), which controls MCP client
notifications.

<hr />

## `DISABLE_LOG_MASKING`

Disable masking of credentials in MCP client notifications and server logs. For debug purposes only.

- Default: `false`

<hr />

## `NOTIFICATION_PAYLOAD_MAX_BYTES`

The maximum string length included in MCP client notifications and server logs before large payloads
are redacted or truncated.

- Default: `8192`
- Must be a positive number.

Binary payloads, large SVG/XML payloads, and large base64 image payloads are redacted. Other strings
larger than this value are truncated.

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
be available. This variable is site overridable, see [Site Settings](site-settings.md).

- Default: Empty string (_all_ are included)
- For a list of available tools and groups, see
  [toolName.ts](https://github.com/tableau/tableau-mcp/blob/main/src/tools/web/toolName.ts).
- Mixing tool names and group names is allowed.

<hr />

## `EXCLUDE_TOOLS`

A comma-separated list of tool or tool group names to exclude from the server. All other tools will
be available. This variable is site overridable, see [Site Settings](site-settings.md).

- Default: Empty string (_none_ are excluded)
- Cannot be provided with `INCLUDE_TOOLS`.

<hr />

## `TOOL_PROFILE`

Selects which tools the Desktop authoring server registers, and whether the combined Web and Desktop
server loads its Web tools lazily. The value is trimmed and lowercased. The standalone Web
server ignores `TOOL_PROFILE`. On the combined server, only `combined-lean` changes the Web half.

- Unset or `dynamic-authoring`: the Desktop server registers a lean native authoring subset.
- `full`: every Desktop tool.
- `demo`: the demo subset. Experimental; it may change or be removed in a minor release.
- `spec-loop`: the spec-loop subset. Experimental; it may change or be removed in a minor release.
- `combined-lean`: the full Desktop surface, and the Web tools load on demand (see below).
- Any other value logs a warning and uses the default (`dynamic-authoring`) set.

Lazy Web loading for `combined-lean` happens only on the combined server, which runs over stdio with
one identity per process. On the standalone Desktop server, `combined-lean` acts like `full`. On the
combined server, only the `load-web-tools` tool is listed for the Web half at startup. A client calls
it with a tool group name (or `all`), the server registers that group's tools, and it sends a
`tools/list_changed` notification. The tool's description lists every group and its tools. Standalone
Web servers register every Web tool.

The `load-web-tools` result is JSON `{ status, toolNames, warnings?, notes? }`:

- `status` is `loaded`, `already-loaded`, or `partial`. `partial` means a retryable failure dropped
  some of the requested tools; call `load-web-tools` again for that group.
- `warnings` lists retryable problems for the requested group only, such as a failed site role
  lookup, a registration condition check that could not be completed, or a tool that failed to
  register.
- `notes` lists deliberate omissions for the requested group, such as a registration condition that
  is not met. Calling again does not change these.
- Tools left out on purpose (site role, `INCLUDE_TOOLS`/`EXCLUDE_TOOLS`, unmet conditions) count as
  loaded, so the group is not retried.

<hr />

## `MAX_REQUEST_TIMEOUT_MS`

The maximum timeout for requests to the Tableau Server REST API.

- Default: `600000` (10 minutes)
- Must be a positive number between `5000` (5 seconds) and `3600000` (1 hour).

<hr />

## `MAX_RESULT_LIMIT`

The maximum number of results that every tool with a `limit` parameter can return when no
tool-specific max result limit is set in the [`MAX_RESULT_LIMITS`](#max_result_limits) variable.
This variable is site and request overridable, see [Site Settings](site-settings.md) and
[Request Overrides](request-overrides.md).

:::warning

Take care when setting this value and be sure to set appropriate tool-specific limits using the
[`MAX_RESULT_LIMITS`](#max_result_limits) variable.

:::

- Default: Empty string (_no limit_)
- Must be a positive number.

<hr />

## `MAX_RESULT_LIMITS`

A comma-separated list of tool names (or tool group names) and the maximum number of results that
each tool (or tools in the group) can return. This variable is site and request overridable, see
[Site Settings](site-settings.md) and [Request Overrides](request-overrides.md).

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
  [toolName.ts](https://github.com/tableau/tableau-mcp/blob/main/src/tools/web/toolName.ts).
- Only applies to tools that have a `limit` parameter and return an array of items.
- Tool names take precedence over tool group names. That is, `datasource:1000,list-datasources:20`
  means that the `list-datasources` tool can return up to 20 data sources but the `query-datasource`
  tool can only return up to 1000 results.
- If a tool is not included in the comma-separated list, the global limit specified by the
  [`MAX_RESULT_LIMIT`](#max_result_limit) variable will be used instead.
- Each limit must be a positive number, or `*` to indicate unbounded results.


<hr />

## `DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS`

Disables requests that are made to the VizQl Data Service for validating queries in the
[`query-datasource`](../../tools/data-qna/query-datasource.md) tool. Does not disable the ability to
query the datasource. This variable is site and request overridable, see
[Site Settings](site-settings.md) and [Request Overrides](request-overrides.md).

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
[`get-datasource-metadata`](../../tools/data-qna/get-datasource-metadata.md) tool. This variable is
site and request overridable, see [Site Settings](site-settings.md) and
[Request Overrides](request-overrides.md).

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
[Session Management](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#session-management)
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
implements the [`TelemetryProvider`](https://github.com/tableau/tableau-mcp/blob/main/src/telemetry/types.ts) interface.

<hr />

## `FEATURE_GATE_PROVIDER`

The feature gate provider to use for feature flag management.

- Default: `server`
- Possible values:
  - `server` - File-based feature gate using `features.json` (default, for on-premise Tableau Server)
  - `custom` - Load a custom feature gate provider from a user-specified module

:::tip[Custom Provider]

To use a custom feature gate provider, set `FEATURE_GATE_PROVIDER=custom` and provide the module path via `FEATURE_GATE_PROVIDER_CONFIG`:

```bash
FEATURE_GATE_PROVIDER=custom
FEATURE_GATE_PROVIDER_CONFIG='{"module":"./my-feature-gate.js"}'
```

The custom provider module should export a default class or named export `FeatureGateProvider` that implements the `FeatureGateProvider` interface.

:::

<hr />

## `FEATURE_GATE_PROVIDER_CONFIG`

Configuration for custom feature gate providers (JSON string).

- Required when: `FEATURE_GATE_PROVIDER` is `custom`
- Format: `{"module": "<path-to-module>", ...additional-config}`

The `module` field can be:
- A relative file path (e.g., `./my-provider.js`) - resolved from process working directory
- An absolute file path (e.g., `/path/to/provider.js`)
- An npm package name (e.g., `@company/feature-gate-provider`)

**Example:**
```bash
FEATURE_GATE_PROVIDER_CONFIG='{"module":"./providers/cloud-feature-gate.js"}'
```

<hr />

## `LATENCY_METRIC_NAME`

The name of the histogram metric used to record HTTP request latency for tool calls.

- Default: `http_server_1agg1_request_duration`
- Only recorded for requests that contain a tool call (non-tool requests such as `initialize` are
  not tracked).

**Example:**

```bash
LATENCY_METRIC_NAME=http_server_1agg1_request_duration
```

<hr />

## `PRODUCT_TELEMETRY_ENABLED`

Enables product telemetry for tool usage tracking.

- Default: `true`. This applies to both the web (Tableau Server and Cloud) and the Desktop variants.
- When `true`, the server sends one `tool_call` event to Tableau's telemetry endpoint for each tool
  call. See [Product telemetry fields](#product-telemetry-fields) for exactly what each variant
  sends.
- Set to `false` to disable product telemetry. Only the exact value `false` disables it. Read
  https://help.tableau.com/current/server/en-us/usage_data_basic_product_data.htm for more
  information

<hr />

## `PRODUCT_TELEMETRY_ENDPOINT`

The URL product telemetry events are sent to.

- Default: `https://prod.telemetry.tableausoftware.com`
- If the value is not a valid URL, the server logs one error on the first tool call and sends no
  product telemetry. Credentials in the URL (`https://user:pass@host`) also count as invalid.

<hr />

## `IS_HYPERFORCE`

Set to `true` to mark the deployment as Hyperforce. Sent as `is_hyperforce` on every product
telemetry event.

- Default: `false`

<hr />

## `TABLEAU_POD_NAME`

Desktop only. The server URL Desktop is signed in to. Sent as `pod` and `podname` on every product
telemetry event. The web variants send the value of `SERVER` instead (`SERVER` wins if both are
set).

<hr />

## `TABLEAU_SITE_LUID`, `TABLEAU_USER_LUID`, `TABLEAU_CHAT_ID`, `TABLEAU_DESKTOP_SESSION_LUID`

Desktop only. Set by the launcher (Tableau Desktop and its agent), not by hand. They are sent as
`site_luid`, `user_luid`, `chat_id` and `session_id` on Desktop product telemetry events. Each is
empty if the launcher did not set it. `TABLEAU_DESKTOP_SESSION_LUID` is ignored unless it is a
well-formed GUID.

<hr />

## Product telemetry fields

Every event also carries `type`, `host_timestamp` (UTC time of the call), `service_name`
(`tableau-mcp`), `podname` and `is_hyperforce`.

| Field                                          | Web                                                                                                                                         | Desktop                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `tool_name`, `request_id`                      | yes                                                                                                                                         | yes                                                                                   |
| `session_id`                                   | MCP session ID, empty on stdio                                                                                                              | `TABLEAU_DESKTOP_SESSION_LUID`, empty if unset                                        |
| `site_luid`, `user_luid`                       | from the signed-in session                                                                                                                  | `TABLEAU_SITE_LUID`, `TABLEAU_USER_LUID`                                              |
| `chat_id`                                      | not sent                                                                                                                                    | `TABLEAU_CHAT_ID`                                                                     |
| `success`                                      | yes                                                                                                                                         | yes                                                                                   |
| `error_code`                                   | empty on success. On failure, the HTTP status of the error, empty if the error result carries none, or `500` for a thrown error without one | status code of a typed tool error, else empty                                         |
| `error_message`                                | text of the tool's error result (free text)                                                                                                 | stable error type slug only (for example `args-validation`), empty for untyped errors |
| `auth_type`                                    | `pat`, `uat`, `direct-trust`, `embedded-oauth`, `tableau-oauth`, `passthrough` or `unknown`                                                 | `desktop`                                                                             |
| `oauth_client_id`, `oauth_client_display_name` | OAuth client of the caller, if any                                                                                                          | empty                                                                                 |

The web `record-event` tool (used only by MCP apps, behind the `mcp-apps` feature flag) also sends a
separate `tableau_mcp_event` with `event_type`, `message` (text supplied by the calling app, cut to
1024 characters), `site_luid` and `user_luid`. Calling it also sends the usual `tool_call` event.

[mcp-transport]: https://modelcontextprotocol.io/docs/concepts/transports
[tab-ds-connections]:
  https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_source_connections
[tab-connect-ds]:
  https://help.tableau.com/current/api/vizql-data-service/en-us/docs/vds_create_queries.html#connect-to-your-data-source

<hr />

## `FLOW_READ_TOOLS_ENABLED`

Controls the read-only Tableau Prep flow tools. They are enabled by default.

- Default: unset, which enables the read-only flow tools
- Set to `true` to enable them explicitly. Any other value is treated as unset
- Set to `false` to disable them
- The mutating flow tools are controlled separately by
  [`FLOW_WRITE_TOOLS_ENABLED`](#flow_write_tools_enabled)
- When enabled, registers:
  - [`list-flows`](../../tools/flows/list-flows.md)
  - [`get-flow`](../../tools/flows/get-flow.md)
  - [`list-flow-runs`](../../tools/flows/list-flow-runs.md)
  - [`list-flow-tasks`](../../tools/flows/list-flow-tasks.md)
  - [`describe-flow`](../../tools/flows/describe-flow.md)
  - [`get-flow-task`](../../tools/flows/get-flow-task.md)
- When disabled, these tools are not registered, and the `tableau:mcp:flow:read` scope is neither
  advertised nor accepted. REST API scopes that an enabled tool still uses stay advertised. For
  example, `run-flow` uses `tableau:flows:read`

<hr />

## `FLOW_WRITE_TOOLS_ENABLED`

Controls the content-**mutating** Tableau Prep flow tools. They are enabled by default. A confirmed
run consumes Tableau Prep Conductor capacity and can overwrite flow outputs. Each tool previews the
change first and returns a single-use confirmation token. The tool makes the change only when it's
called again with that token, after the user approves the preview.

- Default: unset, which enables the mutating flow tools
- Set to `true` to enable them explicitly. Any other value is treated as unset
- Set to `false` to disable them
- The read-only flow tools are controlled separately by
  [`FLOW_READ_TOOLS_ENABLED`](#flow_read_tools_enabled)
- When enabled, registers:
  - [`run-flow`](../../tools/flows/run-flow.md) — run a flow on demand (Run Flow Now)
  - [`run-flow-task`](../../tools/flows/run-flow-task.md) — run an existing scheduled task now (Run Flow Task)
  - [`cancel-flow-run`](../../tools/flows/cancel-flow-run.md) — request cancellation of a flow run (Cancel Flow Run)
- When disabled, these tools are not registered, and the `tableau:mcp:flow:run` and
  `tableau:mcp:flow:cancel` scopes are neither advertised nor accepted. Their REST API scopes
  (`tableau:flows:run`, `tableau:flow_tasks:run`, and `tableau:flow_runs:update`) are not advertised
- These tools require **Data Management with Tableau Prep Conductor**, and the site's **Run Now** setting must be enabled. They honor the caller's flow permissions and the server's `INCLUDE_PROJECT_IDS` / `INCLUDE_TAGS` bounded context
- Known REST API minimums are preflighted before mutation (`run-flow`: 3.14+; `cancel-flow-run`: 3.10+). License, site-setting, deployment, and permission failures are surfaced from Tableau's REST error details
- You can still remove individual flow tools with [`EXCLUDE_TOOLS`](#exclude_tools), or remove all
  of them with `EXCLUDE_TOOLS=flow`

| `FLOW_READ_TOOLS_ENABLED` | `FLOW_WRITE_TOOLS_ENABLED` | Registered flow tools |
| --- | --- | --- |
| unset or `true` | unset or `true` | read-only and mutating flow tools |
| unset or `true` | `false` | read-only flow tools |
| `false` | unset or `true` | mutating flow tools |
| `false` | `false` | none |

<hr />

## `ADMIN_TOOLS_ENABLED`

Enables admin-only tools that require site administrator permissions.

- Default: `false`
- When `true`, enables tools that are restricted to Tableau site administrators:
  - [`list-extract-refresh-tasks`](../../tools/tasks/list-extract-refresh-tasks.md)
  - [`update-cloud-extract-refresh-task`](../../tools/tasks/update-cloud-extract-refresh-task.md)
  - [`list-jobs`](../../tools/jobs/list-jobs.md)
  - [`list-users`](../../tools/users/list-users.md)
  - [`delete-content`](../../tools/content/delete-content.md)
  - [`query-admin-insights`](../../tools/admin-insights/query-admin-insights.md)
- These tools require the user to have one of the following site roles:
  - SiteAdministratorCreator
  - SiteAdministratorExplorer
  - ServerAdministrator
- Admin tools perform runtime role verification and will return a 403 error if the user does not
  have the required permissions.

<hr />

## `ADMIN_GATE_CACHE_TTL_MINUTES`

TTL (in minutes) for caches used by admin-only tools. Affects:

- Admin role lookups (`assertAdmin`)
- Admin Insights dataset LUID resolution
- Project ID → name resolution used by `query-admin-insights` (`kind: "stale-content"`)

- Default: `5`
- Minimum: `1`
- Maximum: `1440` (24 hours)

Tune lower if site role / project metadata changes need to propagate faster. Tune higher under
memory pressure to reduce REST traffic.

<hr />

## `MUTATION_PREVIEW_TTL_MINUTES`

TTL (in minutes) for the single-use confirmation tokens minted by the preview phase of two-phase
mutation tools (e.g. [`delete-content`](../../tools/content/delete-content.md)).
A token must be supplied on the confirmed call before it expires, otherwise the caller must re-run
the preview.

- Default: `5`
- Minimum: `1`
- Maximum: `1440` (24 hours)

Tune lower to shorten the window in which a preview token is valid. Tune higher to give callers more
time between preview and confirmation.

<hr />

## `STALE_CONTENT_MIN_AGE_DAYS`

Default minimum days since last access for content to be considered stale by the
[`query-admin-insights`](../../tools/admin-insights/query-admin-insights.md) tool's `kind: "stale-content"` backend. Callers
can pass an explicit `minAgeDays` argument to override per-call.

- Default: `90`
- Minimum: `1`
- Maximum: `3650` (10 years)

Overridable per-site via [Site Settings](site-settings.md) and per-request via
[Request Overrides](request-overrides.md#stale_content_min_age_days).

<hr />

## `PENDING_DELETION_MAX_AGE_DAYS`

The oldest cleanup batch, in days, that a [`delete-content`](../../tools/content/delete-content.md)
confirm still accepts for a workbook or data source. A confirm whose `cleanupDate` is older is
rejected with `cleanup-batch-expired` and nothing is deleted, so a `pending-deletion-YYYY-MM-DD`
marker left by a crashed or abandoned preview stops authorizing deletes on its own. The marker
itself is not removed — clear it with
[`delete-content`](../../tools/content/delete-content.md#pending-deletion-markers) with `action: "remove-pending-tags"`.

Set it longer than any grace/notification window you use between tagging and deleting.

- Default: `30`
- Minimum: `1`
- Maximum: `90` (a batch older than this could never be previewed-then-confirmed in practice)

Out-of-range or non-numeric values fall back to the default. Not overridable per site or per
request.

<hr />

## `STALE_CONTENT_MAX_ROWS`

Maximum number of stale-content rows the
[`query-admin-insights`](../../tools/admin-insights/query-admin-insights.md) tool's
`kind: "stale-content"` backend will return in a single call. This is a server-side safety cap that
protects the destructive stale-content cleanup flow from acting on an unreviewed mass set.

When the stale-item count exceeds this cap, the tool **withholds the row payload** (`rows: []`) and
returns a structured `ROW_CAP_EXCEEDED` warning in `mcp.warnings`. The `totalStaleItems` and
`totalStaleSizeBytes` fields still report the **true** pre-cap totals so callers can see the
magnitude and narrow scope (e.g. a specific `projectIds` subset or a higher `minAgeDays`) before
re-running.

- Default: `100`
- Minimum: `1`
- Maximum: `10000`

Overridable per-site via [Site Settings](site-settings.md) and per-request via
[Request Overrides](request-overrides.md#stale_content_max_rows).

<hr />

## `LICENSE_RECLAIM_INACTIVE_DAYS`

Default minimum days of inactivity before a user is considered a license reclamation candidate by
the [`user-license-reclamation-inform`](../../prompts/user-license-reclamation-inform.md) prompt.
Callers can pass an explicit `inactiveDays` argument to override per-invocation.

- Default: `90`
- Minimum: `1`
- Maximum: `3650` (10 years)

<hr />

## `LICENSE_RECLAIM_ROLES`

Comma-separated list of site roles targeted for license reclamation by the
[`user-license-reclamation-inform`](../../prompts/user-license-reclamation-inform.md) prompt.
Callers can pass an explicit `roles` argument to override per-invocation.

- Default: `Creator,Explorer`
- Values must be valid Tableau site role names (e.g., `Creator`, `Explorer`, `Viewer`).

<hr />

## `BREAK_GLASS_DISABLE_GLOBALLY`

Can be used to force all MCP tools to return a "service unavailable" error message. Use with
discretion.

- Default: `false`
- When `true`, all tools will return the below result:

```json
{
  "content": [
    {
      "type": "text",
      "text": "The Tableau MCP server is temporarily unavailable. Please try again later."
    }
  ],
  "isError": true
}
```

<hr />

## `CSP_ALLOWED_DOMAINS`

A comma-separated list of domains to allow in the Content-Security-Policy header for MCP apps.

- Default: `https://*.online.tableau.com,https://*.tableau.com`
- The configured [`SERVER`](#server) origin is automatically appended to this list.
- Use this to quickly add or modify allowed domains without requiring a code change and release.

**Example:**

```bash
CSP_ALLOWED_DOMAINS=https://*.mycompany.tableau.com,https://*.online.tableau.com
```

This allows embedding Tableau visualizations from custom Tableau Server domains in addition to the default Tableau Cloud domains.

<hr />

## `MCP_S3_BUCKET`

Enables offloading rendered view images to Amazon S3. When set, the `get-view-image` and
`get-custom-view-image` tools upload the rendered image to this bucket and return a short-lived
presigned URL (as a `resource_link` content block) instead of inlining the image as base64. The
client fetches the image bytes directly from S3, so the image never streams back through the MCP
server on read.

- Default: unset (feature disabled — tools return inline base64, the original behavior).
- When set, must be a valid S3 bucket name (lowercase letters, numbers, dots, and hyphens only).
- AWS credentials are resolved via the default AWS SDK credential chain (IAM role / instance
  profile / standard `AWS_*` environment variables); no credentials are read from the MCP config.
- If an upload fails, the tool falls back to returning inline base64 and logs a warning, so image
  retrieval never hard-fails.

**Example:**

```bash
MCP_S3_BUCKET=tableau-images
```

<hr />

## `AWS_DEFAULT_REGION`

The AWS region of the S3 bucket used for image offload.

- Default: unset. If not set, the AWS SDK resolves the region from the environment via its standard
  credential/region chain.
- Only relevant when [`MCP_S3_BUCKET`](#mcp_s3_bucket) is set.

**Example:**

```bash
AWS_DEFAULT_REGION=us-east-1
```

<hr />

## `MCP_IMAGE_PREFIX`

The base key prefix (folder path) under which uploaded images are stored in the bucket. Each
view-image tool appends its own segment to this base, so images are namespaced per tool. Slashes are
normalized automatically.

- Default: unset (empty). When unset, each tool uses only its own segment.
- Per-tool segments: `get-view-image` → `view-images/`, `get-custom-view-image` →
  `custom-view-images/`.
- Objects are keyed as `<base><tool-segment><resourceId>/<uuid>.<ext>`. For example, with
  `MCP_IMAGE_PREFIX=tableau/`, a view image is keyed under `tableau/view-images/...` and a custom
  view image under `tableau/custom-view-images/...`. Unset, they are keyed under `view-images/...`
  and `custom-view-images/...` respectively.
- Only relevant when [`MCP_S3_BUCKET`](#mcp_s3_bucket) is set.

**Example:**

```bash
MCP_IMAGE_PREFIX=tableau/
```

<hr />

## `FILE_TTL`

The lifetime of the presigned GET URL that is returned to the client. The value is in seconds. The link
should be fetched promptly rather than stored.

- Default: `30` (30 seconds).
- Clamped to the range `5`–`900` (5 seconds–15 minutes).
- Only relevant when [`MCP_S3_BUCKET`](#mcp_s3_bucket) is set.

**Example:**

```bash
FILE_TTL=30
```
<hr />

## Desktop

The Tableau Desktop authoring server (`build/index.desktop.js`) reads these variables in addition to
the shared ones above (for example [`TRANSPORT`](#transport), which must be `stdio`,
[`ENABLED_LOGGERS`](#enabled_loggers) and [`TOOL_PROFILE`](#tool_profile)). The combined variant
reads them too. It builds the Desktop config at startup, so they apply there as well. Both entry
points load a `.env` file from the working directory before reading the environment.

This section is one table on purpose: most of these are set by the app that launches the server, not
by end users. Each row is tagged:

- **spawner**: set by the app that launches the server. Not for end users.
- **dev/test**: overrides for development and tests.
- **user**: safe for anyone to set.

For numeric values, an unparseable value or a value below the minimum is ignored and the default is
used (it is not raised to the minimum). A value above a clamp is lowered to the clamp.

| Variable                                                                                                        | Default                                                                                                                                                                                                                    | Bounds                                   | What it does                                                                                                                                                                                                                                                                     | Who sets it |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `EPISODE_EVENTS`                                                                                                | off                                                                                                                                                                                                                        | exactly `on` enables                     | Writes episode events (JSON lines, `episodes-<timestamp>.jsonl`) to `EPISODE_EVENTS_DIR`.                                                                                                                                                                                        | user        |
| `EPISODE_EVENTS_DIR`                                                                                            | `FILE_LOGGER_DIRECTORY`                                                                                                                                                                                                    |                                          | Directory for the episode event files. The server never deletes these files; use a directory you clean up yourself. See [`FILE_LOGGER_DIRECTORY`](#file_logger_directory).                                                                                                       | user        |
| `INLINE_XML_MAX_BYTES`                                                                                          | `16384`                                                                                                                                                                                                                    | minimum `1`                              | Largest XML returned inline by any get-XML tool (workbook, worksheet, dashboard, datasource, storyboard). Above it, the tool responds in file mode. | user        |
| `INLINE_IMAGE_MAX_BYTES`                                                                                        | `1048576` (1 MiB)                                                                                                                                                                                                          | minimum `1`                              | Largest image returned inline by the export-image tools and `capture-window-screenshot`. SVG counts about twice its decoded size, because it is sent as both text and an image block. Above the cap, the tool writes a cache file and returns its path. | user        |
| `IMAGE_EXPORT_TIMEOUT_MS`                                                                                       | `30000`                                                                                                                                                                                                                    | minimum `1`, clamped to `2147483647`     | Deadline for the image-render call. Bounds a hang when Desktop is showing a blocking dialog.                                                                                                                                                                                     | user        |
| `TABLEAU_DESKTOP_CALL_TIMEOUT_MS`                                                                               | `60000`                                                                                                                                                                                                                    | minimum `40000`, clamped to `2147483647` | Wall-clock ceiling on one Desktop tool call. Past it the call aborts and the agent is told Desktop stopped answering. A value under `40000` is ignored and `60000` is used.                                                                                                      | user        |
| `TABLEAU_DESKTOP_SESSION_ID`                                                                                    | none                                                                                                                                                                                                                       | must be digits only (a Desktop pid)      | Pins the Desktop instance session-scoped tools default to. The agent can still target another open Desktop. Anything that is not a pid is ignored.                                                                                                                               | spawner     |
| `TABLEAU_USER_AGENT_PREFIX`                                                                                     | none                                                                                                                                                                                                                       | a single `name/version` product token; anything else is ignored| Product token the launcher puts at the front of the External Client API `User-Agent`, ahead of `tableau-desktop-mcp/<version>`. Desktop attributes each call to the leading token. Tableau Agent sets `tableau-agent/<version>`.                                                 | spawner     |
| `TABLEAU_EXTERNAL_API_DISCOVERY_DIR`                                                                            | OS default root: `%LOCALAPPDATA%` on Windows (`~\AppData\Local` if unset), `~/Library/Application Support` on macOS, `$XDG_DATA_HOME` (else `~/.local/share`) on Linux. Two folders are searched, in order: `<root>/Tableau/Tableau/ExternalApi`, then `<root>/Tableau/ExternalApi` |                                          | Directory searched for running Desktop instances. When set, it is the only directory searched.                                                                                                                                                                                   | dev/test    |
| `TABLEAU_COMMANDS_REGISTRY_DIR`                                                                                 | none                                                                                                                                                                                                                       | blank is treated as unset                | Directory with the Desktop command and parameter registry JSON files. Without it the commands reference is unavailable.                                                                                                                                                          | spawner     |
| `TABLEAU_KNOWLEDGE_DIR`                                                                                         | none (the knowledge corpus is empty)                                                                                                                                                                                       |                                          | Knowledge roots served as `expertise://` resources. Separate several roots with the OS path delimiter (`:` on macOS and Linux, `;` on Windows). Earlier roots win on a name collision.                                                                                           | spawner     |
| `TEMPLATES_DIR`                                                                                                 | the bundled `templates` directory                                                                                                                                                                                          |                                          | Replaces the whole template catalog with this directory.                                                                                                                                                                                                                         | dev/test    |
| `TABLEAU_REPOSITORY_DIR`                                                                                        | none                                                                                                                                                                                                                       |                                          | Adds three external template folders under this directory, in order: `Tableau Agent/templates/.vendored/overridable`, `Bookmarks`, then `Tableau Agent/templates`. A later folder overrides a bundled or earlier template with the same name. Ignored when `TEMPLATES_DIR` is set. | spawner     |
| `WORKBOOK_XSD_PATH`                                                                                             | the bundled workbook XSD                                                                                                                                                                                                   |                                          | Workbook XSD file for the search library. No registered tool reads it now.                                                                                                                                                                                                                              | dev/test    |
| `TWB_INDEX_PATH`                                                                                                | the bundled workbook example index                                                                                                                                                                                         |                                          | JSON index of example workbooks. No registered tool reads it now. A path that does not exist gives an empty index.                                                                                                                                                                                                | dev/test    |
| `EXAMPLES_DIR`                                                                                                  | the bundled `examples`                                                                                                                                                                                                     |                                          | Directory of `.json` and `.md` examples for the search library. No registered tool reads it now. When set, even to an empty string, only this directory is read and the bundled examples are not used. An empty string or a missing directory gives no examples.                                                   | dev/test    |
| `SYSTEM_PROMPT_VERSION`                                                                                         | `mcp-server@<server version>`                                                                                                                                                                                              |                                          | Sent as `system_prompt_version` on the episode-begin event only. | spawner     |
| `AGENT_TYPES`                                                                                                   | none                                                                                                                                                                                                                       |                                          | Comma-separated agent types, sent as `agent_types` on the episode-begin event only. Blank entries are dropped. | spawner     |
| `LANGSMITH_RUN_ID`, `LANGSMITH_TRACE_ID`                                                                        | none                                                                                                                                                                                                                       |                                          | Sent as `langsmith_run_id` on the episode-begin event only. `LANGSMITH_RUN_ID` wins when both are set. | spawner     |
| `ENABLE_FILTER_GUARDRAIL`                                                                                       | off                                                                                                                                                                                                                        | exactly `true` enables                   | Blocks a proposal with more than 5 categorical filter controls. Any other value, including `false`, `0` and `1`, leaves it off.                                                                                                                                                  | dev/test    |
| `ALLOW_SKIP_VALIDATION`                                                                                         | `false`                                                                                                                                                                                                                    | exactly `true` enables                   | **Turns off the bind-template preflight.** With it set, a caller can pass `skip_validation` to `bind-template` and skip validation of the proposal before apply. Only a trusted spawner that builds proposals in code should set it. Never set it for an ordinary agent session. | spawner     |
| `TABLEAU_POD_NAME`, `TABLEAU_SITE_LUID`, `TABLEAU_USER_LUID`, `TABLEAU_CHAT_ID`, `TABLEAU_DESKTOP_SESSION_LUID` | none                                                                                                                                                                                                                       |                                          | Product telemetry context. See [`TABLEAU_POD_NAME`](#tableau_pod_name) and [the LUID and chat id variables](#tableau_site_luid-tableau_user_luid-tableau_chat_id-tableau_desktop_session_luid).                                                                                  | spawner     |
| `TABLEAU_MCP_CACHE_DIR`                                                                                         | `<bundle dir>/../cache`                                                                                                                                                                                                    | absolute path; blank or relative ignored | Directory for cache files (cached XML, exported images) and the only place `read-cached-xml` and `write-cached-xml` accept. Tableau Agent sets a per-session directory so concurrent sessions do not share cache files.                                                          | spawner     |
| `PRODUCT_TELEMETRY_ENABLED`, `PRODUCT_TELEMETRY_ENDPOINT`, `IS_HYPERFORCE`                                      |                                                                                                                                                                                                                            |                                          | See [`PRODUCT_TELEMETRY_ENABLED`](#product_telemetry_enabled), [`PRODUCT_TELEMETRY_ENDPOINT`](#product_telemetry_endpoint) and [`IS_HYPERFORCE`](#is_hyperforce).                                                                                                                | spawner     |
