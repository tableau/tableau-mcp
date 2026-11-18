---
sidebar_position: 9
title: Configure a Local Tableau MCP Service
---

# Configure a Local Tableau MCP Service
This page is a guide for individual users running Tableau MCP **locally** — as a `stdio` server
launched by your AI tool (MCP client) via `npx`, `node`, or Docker. It explains where to put
configuration and which settings are most useful when you are running the server just for yourself.

If you have not set up a local server yet, start with [Getting Started](../../getting-started).
For an administrator-focused view of a shared, multi-user deployment, see
[Configuration for Site Administrators](site-administrators.md).

:::info

A "local service" here means the default [`stdio`](env-vars.md#transport) transport, where your MCP
client starts and stops the server process for you. Configuration is supplied through **environment
variables**, most commonly in your client's MCP config `env` block or in a `.env` / `env.list` file.

:::

## Where to put configuration

For a local server, you can provide environment variables in any of these ways:

- **In your MCP client config** — the `env` block of the server entry (see the examples below).
  This keeps everything self-contained in your client's configuration.
- **In a `.env` file** — placed where the server can read it. Useful when you build from source and
  want to keep credentials out of your client config.
- **In an `env.list` file** — passed to Docker with `--env-file env.list`.
- **System / user environment variables** — inherited by the server process.

:::danger

Treat your `.env`, `env.list`, and client config as secrets. They can contain a PAT value, OAuth
secrets, or connected-app keys. Do not commit them to source control. Credentials are masked in
logs by default — leave [`DISABLE_LOG_MASKING`](env-vars.md#disable_log_masking) at `false`.

:::

## Minimal configuration

At a minimum, a local server needs to know how to reach Tableau and how to authenticate. For local,
single-user use, a [Personal Access Token (PAT)](authentication/pat.md) is the simplest option.

```json
{
  "mcpServers": {
    "tableau": {
      "command": "npx",
      "args": ["-y", "@tableau/mcp-server@latest"],
      "env": {
        "SERVER": "https://my-tableau-server.com",
        "SITE_NAME": "my_site",
        "AUTH": "pat",
        "PAT_NAME": "my_pat",
        "PAT_VALUE": "pat_value"
      }
    }
  }
}
```

| Variable | Purpose |
|---|---|
| [`SERVER`](env-vars.md#server) | URL of your Tableau Cloud pod or Tableau Server. |
| [`SITE_NAME`](env-vars.md#site_name) | Content URL of your site. |
| [`AUTH`](env-vars.md#auth) | Authentication method — `pat` is typical for local use. |
| [`PAT_NAME`](authentication/pat.md) / [`PAT_VALUE`](authentication/pat.md) | Your personal access token credentials. |

:::tip

`SITE_NAME` is the site's **Content URL**, which can differ from the display name. For Tableau
Server, you can leave it blank to use the default site.

:::

## Configuring behavior

Once the basics work, you can tailor the server to your workflow. These variables all work the same
way locally as they do server-side — set them in your `env` block or `.env` file.

### Choose which tools are available

- [`INCLUDE_TOOLS`](env-vars.md#include_tools) — register only the listed tools or tool groups.
- [`EXCLUDE_TOOLS`](env-vars.md#exclude_tools) — register everything except the listed tools.
- Provide only one of the two.

```json
"env": {
  "INCLUDE_TOOLS": "query-datasource,list-datasources,get-datasource-metadata"
}
```

Some tool groups are gated behind their own flags and must be turned on explicitly:

- [`FLOW_READ_TOOLS_ENABLED`](env-vars.md#flow_read_tools_enabled) — enables the Tableau Prep flow tools.
- [`ADMIN_TOOLS_ENABLED`](env-vars.md#admin_tools_enabled) — enables admin-only tools. These still
  require your Tableau user to have a site administrator role; enabling the flag alone does not grant
  access.

### Limit which content the tools touch

If you only ever work with a handful of data sources, workbooks, or projects, you can scope the
server to them. See [Tool Scoping](tool-scoping.md).

```json
"env": {
  "INCLUDE_DATASOURCE_IDS": "2d935df8-fe7e-4fd8-bb14-35eb4ba31d4"
}
```

### Cap result sizes

Keep responses small and fast (and easier for your model to reason over) with result limits:

- [`MAX_RESULT_LIMIT`](env-vars.md#max_result_limit) — a global cap for tools with a `limit`
  parameter.
- [`MAX_RESULT_LIMITS`](env-vars.md#max_result_limits) — per-tool caps.

```json
"env": {
  "MAX_RESULT_LIMIT": "50",
  "MAX_RESULT_LIMITS": "query-datasource:1000,list-datasources:20"
}
```

### Tune logging for troubleshooting

When something is not working, local logs are your best friend:

- [`ENABLED_LOGGERS`](env-vars.md#enabled_loggers) — add `fileLogger` to write detailed logs
  (including tool calls and REST API traces) to disk.
- [`FILE_LOGGER_DIRECTORY`](env-vars.md#file_logger_directory) — where those log files go.
- [`LOG_LEVEL`](env-vars.md#log_level) — set to `debug` for maximum detail.
- [`DEFAULT_NOTIFICATION_LEVEL`](env-vars.md#default_notification_level) — the minimum level of
  notifications sent to your MCP client.

```json
"env": {
  "ENABLED_LOGGERS": "appLogger,fileLogger",
  "LOG_LEVEL": "debug"
}
```

:::tip

For local debugging you can also use the [MCP Inspector](../../developers/mcp-inspector.md) to call
tools directly and watch requests and responses. To step through the server with breakpoints, see
[Debugging](../../developers/debugging.md).

:::

### Data source credentials

If you query data sources that require their own username and password, provide them with
[`DATASOURCE_CREDENTIALS`](env-vars.md#datasource_credentials).

## Running from source or Docker

The configuration above applies regardless of how you launch the server — only *where* you put the
environment variables changes:

- **From source (`node build/index.js`)** — keep your settings in a `.env` file next to the build
  instead of the client config's `env` block.
- **Docker** — pass them with `--env-file env.list`.

For the full launch snippets (npx, Node, and Docker) and first-time setup, see
[Getting Started](../../getting-started); for details on the container image, see
[Docker](../../extras/docker.md).

## Applying changes

Environment variables are read when the server process starts. After editing your client config,
`.env`, or `env.list`, **relaunch your AI tool** (or refresh its MCP tools) so a fresh server
process picks up the new values. When building from source, rebuild with `npm run build` after
pulling changes before relaunching.

## Related

- [Getting Started](../../getting-started) — install and first run.
- [Environment Variables](env-vars.md) — the full catalog of settings.
- [Authentication](authentication) — PAT, direct trust, and OAuth options.
- [Tool Scoping](tool-scoping.md) — limit tools to specific content.
- [MCP Inspector](../../developers/mcp-inspector.md) — test tools locally.
- [Configuration for Site Administrators](site-administrators.md) — the shared-deployment
  counterpart to this page.
