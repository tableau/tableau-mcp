---
sidebar_position: 5
---

# HTTP Server

The Tableau MCP server can be configured to run as an HTTP server, leveraging the Streaming HTTP MCP
transport. This is useful for deploying the server remotely and exposing it to multiple clients.

When `TRANSPORT` is `http`, the following environment variables can be used to configure the HTTP
server. They are all optional.

## `HTTP_PORT_ENV_VAR_NAME`

The environment variable name to use for the HTTP server port.

- Default: `PORT`

<hr />

## `[Value of HTTP_PORT_ENV_VAR_NAME]`

The port to use for the HTTP server.

- Default: `3927`

<hr />

## `SSL_KEY`

The path to the SSL key file to use for the HTTP server.

<hr />

## `SSL_CERT`

The path to the SSL certificate file to use for the HTTP server.

<hr />

## `CORS_ORIGIN_CONFIG`

The origin or origins to allow CORS requests from.

- Default: `true`
- Acceptable values include `true`, `false`, `*`, or a URL or array of URLs. See [cors config
  options][cors] for details.

[cors]: https://expressjs.com/en/resources/middleware/cors.html#configuration-options
