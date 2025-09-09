---
sidebar_position: 4
---

# Enabling OAuth

:::warning

Tableau Server 2025.3+ only. Tableau Cloud is not supported yet but is coming soon ETA Q2 2026.

Otherwise, you can still test by running the MCP server locally.

:::

When a URL for `OAUTH_ISSUER` is provided, the MCP server will act as an OAuth 2.1 resource server,
capable of accepting and responding to protected resource requests using encrypted access tokens.
When enabled, MCP clients will first require logging in via Tableau OAuth to connect to the MCP
server. For more information, please see the
[MCP Authorization spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization).

<hr />

## Environment Variables

When OAuth is enabled, the following environment variables also apply or have additional meaning:

### `AUTH`

The method the MCP server uses to authenticate to the Tableau REST APIs.

- Defaults to `oauth` when OAuth is enabled.
- Can still be set to other authentication methods. See [Authentication](env-vars#auth) for options.
- When set to a value _other_ than `oauth`, the MCP server will still be protected from unauthorized
  access by OAuth but will _not_ use the Tableau session initiated by the Tableau OAuth flow to
  authenticate to the Tableau REST APIs. For example, if `AUTH` is set to `pat`, the MCP server will
  use the values of [`PAT_NAME`](authentication/pat#pat_name) and
  [`PAT_VALUE`](authentication/pat#pat_value) to authenticate to the Tableau REST APIs.

<hr />

### `OAUTH_ISSUER`

The issuer of the OAuth server. This should be the host of the MCP server.

- Required if `AUTH` is `oauth`. For testing, use `http://127.0.0.1:3927`.
- Required if `TRANSPORT` is `http` unless opted out with [`DISABLE_OAUTH`](#disable_oauth).

<hr />

### `TRANSPORT`

The MCP transport type to use for the server.

- Defaults to `http` when OAuth is enabled.
- Must be `http` when OAuth is enabled.

<hr />

### `SERVER`

- When [`AUTH`](#auth) is `oauth`, leave this empty to support any Tableau Cloud pod determined by
  the site the user signed into when connecting to the MCP server.

<hr />

### `SITE_NAME`

The target Tableau site for OAuth.

- When [`AUTH`](#auth) is `oauth`, leaving this empty means any site will be supported, determined
  by the site the user signed into when connecting to the MCP server.

<hr />

### `OAUTH_REDIRECT_URI`

The redirect URI for the OAuth flow.

- Default: `${OAUTH_ISSUER}/Callback`
- Recommended to not define a value at all and just rely on its default value.
- Path must be `/Callback` (case-sensitive).

:::info

Tableau Server administrators must also use
[tsm](https://help.tableau.com/current/server/en-us/cli_configuration-set_tsm.htm) to set
`oauth.allowed_redirect_uri_hosts` to the host of the MCP server.

The value should be the same as [`OAUTH_ISSUER`](#oauth_issuer) but without the protocol or any
trailing slash.

```cmd
tsm configuration set -k oauth.allowed_redirect_uri_hosts -v tableau-mcp.example.com
tsm pending-changes apply
```

:::

<hr />

### `OAUTH_JWE_PRIVATE_KEY_PATH`

The absolute path to the RSA private key (.pem) file used to decrypt the OAuth access token.

- Required.
- Only PEM format is supported.

:::info

The access token issued by the MCP server is encrypted using JWE (JSON Web Encryption) using an RSA
public key. This public key is derived from the provided RSA private key.

MCP clients provide this encrypted access token to the MCP server on the `Authorization` header of
its requests. The MCP server decrypts the access token using the provided private key and uses the
Tableau access token held within to authenticate subsequent requests to Tableau APIs. Any requests
to the MCP server that do not have a valid access token will be rejected.

If you need a private key, you can generate one using
[openssl-genrsa](https://docs.openssl.org/3.0/man1/openssl-genrsa/) e.g.

```cmd
openssl genrsa -out private.pem
```

:::

<hr />

### `OAUTH_JWE_PRIVATE_KEY_PASSPHRASE`

The passphrase for the private key if it is encrypted.

<hr />

### `OAUTH_AUTHORIZATION_CODE_TIMEOUT_MS`

The timeout for the OAuth authorization codes.

- Default: 10 seconds.
- Max: 1 hour.

<hr />

### `OAUTH_ACCESS_TOKEN_TIMEOUT_MS`

The timeout for the OAuth access tokens.

- Default: 24 hours.
- Max: 30 days.

<hr />

### `OAUTH_REFRESH_TOKEN_TIMEOUT_MS`

The timeout for the OAuth refresh tokens.

- Default: 30 days.
- Max: 1 year.

<hr />

### `DISABLE_OAUTH`

:::warning

When `TRANSPORT` is `http`, the default behavior changes to require protecting your MCP server with
OAuth as a security best practice.

To opt out of this behavior at your own risk, set `DISABLE_OAUTH` to `true`.

This is not recommended as your MCP server will not be protected from unauthorized access.

:::

- Default: `false`

<hr />
