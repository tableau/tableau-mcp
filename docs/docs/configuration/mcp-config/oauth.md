---
sidebar_position: 6
---

# OAuth

:::warning

Tableau Server 2025.3+ only. Tableau Cloud is not supported yet but is coming soon ETA Q2 2026

:::

When a URL for `OAUTH_ISSUER` is provided, the MCP server will act as an OAuth 2.1 resource server,
capable of accepting and responding to protected resource requests using access tokens. When
enabled, MCP clients will require logging in via Tableau OAuth to access the MCP server. For more
information, please see the
[MCP Authorization spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization).

<hr />

## Environment Variables

The following environment variables also apply or have additional meaning:

### `OAUTH_ISSUER`

The issuer of the OAuth server. This should be the host of the MCP server.

- Required if `AUTH` is `oauth`. For testing, use `http://127.0.0.1:3927`

<hr />

### `TRANSPORT`

The MCP transport type to use for the server.

- Default: `http`
- Must be `http` when OAuth is enabled.

<hr />

### `SITE_NAME`

The target Tableau site for OAuth.

- Not required if `AUTH` is `oauth` and users will see the site picker if they have access to
  multiple sites.
- Choosing a site from a Cloud pod different from the one specified in `SERVER` will not work and
  tool calls will fail.

<hr />

### `OAUTH_REDIRECT_URI`

The redirect URI for the OAuth flow.

- Default: `${OAUTH_ISSUER}/Callback`
- Recommended to not define a value at all and just rely on its default value.
- Path must be `/Callback`.

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
- The public key used to encrypt the MCP access token is derived from the provided RSA private key.
  You don't need to provide the public key.

:::info

The access token issued by the MCP server is encrypted using JWE (JSON Web Encryption) using an RSA
public key. MCP clients will provide this access token to the MCP server on the `Authorization`
header of its requests. The MCP server will decrypt the access token using the private key and use
the decrypted access token to authenticate subsequent requests to Tableau APIs. Any requests to the
MCP server that do not have a valid access token will be rejected.

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
