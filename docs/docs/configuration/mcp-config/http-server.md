---
sidebar_position: 5
---

# HTTP Server

The Tableau MCP server can be configured to run as an HTTP server, leveraging the Streaming HTTP MCP
transport. This is useful for deploying the server remotely and exposing it to multiple clients.

:::warning

When `TRANSPORT` is `http`, the default behavior changes to require protecting your MCP server with
OAuth as a security best practice.

To opt out of this behavior at your own risk, please see the entry on
[`DANGEROUSLY_DISABLE_OAUTH`](oauth.md#dangerously_disable_oauth).

:::

When `TRANSPORT` is `http`, the following environment variables can be used to configure the HTTP
server. They are all optional.

## `AUTH`

The method the MCP server uses to authenticate to the Tableau REST APIs.

- Default: `oauth` unless OAuth is disabled with
  [`DANGEROUSLY_DISABLE_OAUTH`](oauth.md#dangerously_disable_oauth) in which case it defaults to
  `pat`.

:::danger

Do not use a PAT when [`TRANSPORT`](env-vars.md#transport) is `http` if you expect simultaneous
requests from multiple clients since PATs cannot be used concurrently. Signing in multiple times
with the same PAT at the same time, whether to the same site or a different site, will terminate any
prior session and will result in an authentication error. See
[Understand personal access tokens](https://help.tableau.com/current/server/en-us/security_personal_access_tokens.htm#understand-personal-access-tokens)
for more details.

[OAuth](./authentication/oauth.md) is recommended but
[Direct Trust](./authentication/direct-trust.md) can also be used.

:::

<hr />

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
