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

MCP logs are written by your AI client, so check that documentation to find their location.

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

## `DISABLE_LOG_MASKING`

Disable masking of credentials in logs. For debug purposes only.

- Default: `false`

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
