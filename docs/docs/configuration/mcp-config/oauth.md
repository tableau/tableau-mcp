---
sidebar_position: 3
---

# Enabling OAuth (Tableau Server)

:::info

These docs are for enabling OAuth for Tableau Server only.

Tableau Cloud customers should refer to
[OAuth: Tableau Cloud](../mcp-config/authentication/oauth.md).

A self-hosted MCP server can instead use
[your own identity provider](#use-your-own-identity-provider-self-hosted-only) with Tableau Server
or Tableau Cloud, signing in with Direct Trust or UAT (UAT is Tableau Cloud only).

:::

## How to Enable OAuth

:::warning

Tableau Server must be version 2025.3 or newer.

:::

To enable OAuth, set the [`OAUTH_ISSUER`](#oauth_issuer) environment variable to the origin of your
MCP server. When a URL for `OAUTH_ISSUER` is provided, the MCP server will act as an OAuth 2.1
resource server, capable of accepting and responding to protected resource requests using encrypted
access tokens.

When OAuth is enabled:

- MCP clients will be required to authenticate via Tableau OAuth before connecting to the MCP server
- The [`TRANSPORT`](#transport) will default to `http` (required for OAuth)
- The [`AUTH`](#auth) method will default to `oauth`

For more information, please see the
[MCP Authorization spec](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization).

<hr />

## Use your own identity provider (self-hosted only)

A self-hosted MCP server can accept access tokens from your own OAuth or OpenID Connect identity
provider (IdP) instead of Tableau. The MCP server checks each token, reads the Tableau username from
one claim, and signs in to Tableau as that user with [Direct Trust](authentication/direct-trust.md)
or [UAT](authentication/uat.md). This mode is not available for hosted Tableau MCP.

To set it up:

- Set [`OAUTH_ISSUER`](#oauth_issuer) to your IdP's issuer and
  [`OAUTH_EMBEDDED_AUTHZ_SERVER`](#oauth_embedded_authz_server) to `false`. Tokens with any other
  `iss` are rejected.
- Set exactly one of:
  - [`OAUTH_EXTERNAL_DISCOVERY`](#oauth_external_discovery) to `true` (JWTs, with the keys read from
    your IdP's OpenID Connect discovery document).
  - [`OAUTH_EXTERNAL_JWKS_URI`](#oauth_external_jwks_uri) (JWTs: access tokens or OpenID Connect ID
    tokens).
  - [`OAUTH_EXTERNAL_INTROSPECTION_URI`](#oauth_external_introspection_uri) (opaque tokens).
- Set [`AUTH`](#auth) to `direct-trust` with `{OAUTH_USERNAME}` in `JWT_SUB_CLAIM`, or to `uat` with
  `{OAUTH_USERNAME}` in `UAT_USERNAME_CLAIM`.
- Have your IdP set the token's `aud` to this server's resource identifier: the
  [`OAUTH_RESOURCE_URI`](#oauth_resource_uri) origin with the `/tableau-mcp` path, or a value in
  [`OAUTH_GLOBAL_RESOURCE_URIS`](#oauth_global_resource_uris). Clients request it with the
  `resource` parameter ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)). The MCP server accepts
  any token with a matching `aud`, so use a value unique to this server. A client ID is fine only if
  it is this MCP server's own client ID and no other app receives tokens for it. Never use a client
  ID shared with another app, or a shared default audience such as Okta's `api://default`.
- Grant the `tableau:mcp:*` scopes your tools need in the `scope` or `scp` claim. The scopes also
  keep out tokens without `tableau:mcp:*` scopes, including ID tokens and tokens meant for other
  apps. Accepting ID tokens requires [`OAUTH_DISABLE_SCOPES`](#oauth_disable_scopes) set to `true`.
  The audience is then the only check that ties a token to this server, so do this only when every
  accepted audience is unique to this server.

:::warning

Pick a [username claim](#oauth_external_username_claim_name) that never changes and that users can't
edit, such as `sub` (the default). Avoid `email` or `preferred_username` unless your IdP guarantees
them: whoever controls the claim value signs in to Tableau as that user.

:::

Also note:

- Passthrough auth (`ENABLE_PASSTHROUGH_AUTH`) runs first. A request with a valid Tableau session is
  accepted without checking a bearer token.
- The token's `client_id` (or `azp`) claim is used as the client ID, which is sent to telemetry.
- Each rejected token writes one `external-token-rejected` record to the `audit` logger, whatever
  [`LOG_LEVEL`](env-vars#log_level) is set to.

### Accept OpenID Connect ID tokens

If your IdP signs users in with OpenID Connect ID tokens instead of access tokens, the MCP server
can accept those as the bearer token. If your IdP publishes an OpenID Connect discovery document,
the issuer is enough:

```bash
OAUTH_ISSUER=https://idp.example.com
OAUTH_EMBEDDED_AUTHZ_SERVER=false
OAUTH_EXTERNAL_DISCOVERY=true
OAUTH_GLOBAL_RESOURCE_URIS=<this-mcp-server-client-id>
OAUTH_DISABLE_SCOPES=true
OAUTH_EXTERNAL_USERNAME_CLAIM_NAME=employee_id
```

Otherwise, set the JWKS URL yourself:

```bash
OAUTH_ISSUER=https://idp.example.com
OAUTH_EMBEDDED_AUTHZ_SERVER=false
OAUTH_EXTERNAL_JWKS_URI=https://idp.example.com/keys
OAUTH_GLOBAL_RESOURCE_URIS=<this-mcp-server-client-id>
OAUTH_DISABLE_SCOPES=true
OAUTH_EXTERNAL_USERNAME_CLAIM_NAME=<username-claim>
```

Use this MCP server's own client ID only if no other app receives tokens for it: with scopes off,
the audience is the only check that ties a token to this server.

On each request, the MCP server checks that:

- The token is signed with an asymmetric algorithm by a key from the JWKS.
- `iss` equals `OAUTH_ISSUER` exactly and `aud` is an accepted value.
- The token has not expired (`exp`) and is already valid (`nbf`, if present), allowing 5 seconds of
  clock skew.
- `iss`, `sub`, `aud`, `exp`, and `iat` are present.
- The [username claim](#oauth_external_username_claim_name) is valid.

Results are not cached. A rejected token gets one generic `401` and an `external-token-rejected`
audit log record with the reason, never the token.

<hr />

## Environment Variables

The following environment variables configure OAuth behavior:

### `AUTH`

The method the MCP server uses to authenticate to the Tableau REST APIs.

- Defaults to `oauth` when OAuth is enabled.
- Can still be set to other authentication methods. See [Authentication](env-vars#auth) for options.
- When set to a value _other_ than `oauth`, the MCP server will still be protected from unauthorized
  access by OAuth but will _not_ use the Tableau session initiated by the Tableau OAuth flow to
  authenticate to the Tableau REST APIs. For example, if `AUTH` is set to `uat`, the MCP server will
  use the [Unified Access Token (UAT)](authentication/uat.md) configuration to authenticate to the
  Tableau REST APIs.

<hr />

### `OAUTH_ISSUER`

**Setting this environment variable enables OAuth.** This should be the origin of your MCP server
(the issuer of access tokens).

When you [use your own identity provider](#use-your-own-identity-provider-self-hosted-only), set it
to the provider's issuer exactly as it appears in the token's `iss` claim. A trailing slash matters.
With [`OAUTH_EXTERNAL_DISCOVERY`](#oauth_external_discovery), it must use `https` unless the host is
loopback.

- Example: `http://127.0.0.1:3927` (for local testing) or `https://tableau-mcp.example.com` (for
  production)
- Required if `AUTH` is `oauth`
- Required if `TRANSPORT` is `http` unless opted out with
  [`DANGEROUSLY_DISABLE_OAUTH`](#dangerously_disable_oauth)

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

The target Tableau site for OAuth. The user must sign in to this site unless
[`OAUTH_LOCK_SITE`](#oauth_lock_site) is `false`.

- Use the site's **Content URL** (not the display name). You can find this in the site URL or in the
  Tableau Server/Cloud admin settings.
- The Content URL may differ from the display name (e.g., Content URL `Internal` vs display name
  `[INTERNAL] My Company`). Either value will be accepted when verifying the site, but Content URL
  is recommended since it is used in Tableau's OAuth flow.

<hr />

### `OAUTH_LOCK_SITE`

Whether to require the user to sign in to the site specified in [`SITE_NAME`](#site_name) when using
OAuth.

- Default: `true`
- When `true`, the user must sign in to the site specified in [`SITE_NAME`](#site_name) (or the
  Default site if empty).
  - If the user already has an active Tableau session in their browser for a different site, an
    error will be returned.
- When `false`, the user can sign in to any site they can access.
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

### `OAUTH_RESOURCE_URI`

The base URL used in the `resource` field of the OAuth protected resource metadata document. Some
clients may require the `resource` field to match exactly with the URL used to access the MCP
server. This should be the base URL of your MCP server deployment.

This value is the deployment domain only (no path). The MCP server is reached at
`<OAUTH_RESOURCE_URI>/tableau-mcp`, which is the canonical resource identifier advertised as
`resource` in the protected resource metadata document. Incoming bearer tokens are
audience-validated against it: the token's `aud` claim must equal
`<OAUTH_RESOURCE_URI>/tableau-mcp`, per [RFC 9068](https://www.rfc-editor.org/rfc/rfc9068) and
[RFC 8707](https://www.rfc-editor.org/rfc/rfc8707). A token whose `aud` matches neither that value
nor [`OAUTH_GLOBAL_RESOURCE_URIS`](#oauth_global_resource_uris) is rejected with a `401`.

- Default: `http://127.0.0.1:3927`
- Example: `http://127.0.0.1:3927` (for local testing) or `https://tableau-mcp.example.com` (for
  production)

<hr />

### `OAUTH_GLOBAL_RESOURCE_URIS`

One or more additional values that are also accepted in a token's `aud` claim. Use this when clients
may reach the deployment through an environment-wide global URL in addition to the pod-specific
[`OAUTH_RESOURCE_URI`](#oauth_resource_uri).

- Optional. When unset, only the `OAUTH_RESOURCE_URI` value is accepted.
- Accepts a single value or a comma-separated list of values.
- Each value is matched against `aud`, so set it to the value the authorization server stamps into
  the claim (for example `https://mcp.tableau.com`). With
  [your own identity provider](#use-your-own-identity-provider-self-hosted-only), a value may be
  this MCP server's own client ID, to [accept ID tokens](#accept-openid-connect-id-tokens).
- Applies only when using a Tableau authorization server or
  [your own identity provider](#use-your-own-identity-provider-self-hosted-only)
  ([`OAUTH_EMBEDDED_AUTHZ_SERVER`](#oauth_embedded_authz_server) is `false`).
- Each value must be unique to this MCP server: any token whose `aud` matches is accepted.

<hr />

### `OAUTH_CLIENT_ID_SECRET_PAIRS`

A comma-separated list of client ID and secret pairs to be used for confidential OAuth clients that
provide client credentials during token requests.

- Optional.
- Example: `client1:secret1,client2:secret2`
- Client IDs and secrets must be unique and cannot contain colons or commas.
- The `/oauth2/token` endpoint accepts client credentials in the request body or the authorization
  header. If both are provided, the request body takes precedence.
- When unspecified, in the authorization server metadata:
  - The `grant_types_supported` field will not include `client_credentials`.
  - The `token_endpoint_auth_methods_supported` field will not include `client_secret_basic` or
    `client_secret_post`.

Example `/oauth2/token` request body:

```json
{
  "grant_type": "client_credentials",
  "client_id": "clientId",
  "client_secret": "secret"
}
```

Example `/oauth2/token` request header:

```
Authorization: Basic Y2xpZW50SWQ6c2VjcmV0
```

Where `Y2xpZW50SWQ6c2VjcmV0` is the base64 encoding of `clientId:secret`.

<hr />

### `OAUTH_DISABLE_SCOPES`

Disable scope enforcement and scope challenges.

- Default: `false`
- Useful for Tableau Server deployments that do not want to enforce scopes yet.
- When `true`, the MCP server will not include scopes in `WWW-Authenticate` challenges and will not
  enforce scopes on incoming access tokens.
- With [your own identity provider](#use-your-own-identity-provider-self-hosted-only), `true` is
  required to [accept ID tokens](#accept-openid-connect-id-tokens), which carry no scopes. It is
  safe only when every accepted audience is unique to this MCP server.

<hr />

### `OAUTH_JWE_PRIVATE_KEY`

The RSA private key used to decrypt the OAuth access token.

- It or `OAUTH_JWE_PRIVATE_KEY_PATH` must be provided, but not both.
- Only PEM format is supported.
- Examples:

  ```
  -----BEGIN RSA PRIVATE KEY-----\nMIIE...HZ3Q==\n-----END RSA PRIVATE KEY-----

  or

  -----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIJ...te1w==\n-----END ENCRYPTED PRIVATE KEY-----
  ```

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

### `OAUTH_JWE_PRIVATE_KEY_PATH`

The absolute path to the RSA private key (.pem) file used to decrypt the OAuth access token.

- It or `OAUTH_JWE_PRIVATE_KEY` must be provided, but not both.
- Only PEM format is supported.

<hr />

### `OAUTH_JWE_PRIVATE_KEY_PASSPHRASE`

The passphrase for the private key if it is encrypted.

<hr />

### `OAUTH_CIMD_DNS_SERVERS`

The Tableau MCP server supports MCP clients that register using a Client ID Metadata Document (CIMD)
URL. Part of this process requires resolving the IP address of the host of the document to protect
against DNS rebinding and Server-Side Request Forgery (SSRF) attacks.

By default, the MCP server will use
[Cloudflare's Public DNS](https://developers.cloudflare.com/1.1.1.1/ip-addresses/) (1.1.1.1 and
1.0.0.1) but you can override this using the `OAUTH_CIMD_DNS_SERVERS` environment variable.

- Default: `1.1.1.1,1.0.0.1`
- Format is a comma-separated list of IP addresses.
- Example: `8.8.8.8,8.8.4.4` (Google's Public DNS)

References:

- https://blog.modelcontextprotocol.io/posts/client_registration/
- https://client.dev/

<hr />

### `OAUTH_EMBEDDED_AUTHZ_SERVER`

A hint that `OAUTH_ISSUER` points at the embedded OAuth authorization server (authorize, token,
callback, register routes). When `false`, the issuer is an external authorization server (Tableau,
or [your own identity provider](#use-your-own-identity-provider-self-hosted-only)); only
`.well-known` endpoints are exposed and JWE key/redirect URI constraints are skipped.

- Default: `true`

<hr />

### `OAUTH_EXTERNAL_JWKS_URI`

The JWKS URL of your identity provider. When set, the MCP server accepts JWTs signed by a key from
this URL: access tokens ([RFC 9068](https://www.rfc-editor.org/rfc/rfc9068)) or
[OpenID Connect ID tokens](#accept-openid-connect-id-tokens). Set only one of this,
[`OAUTH_EXTERNAL_DISCOVERY`](#oauth_external_discovery), or
[`OAUTH_EXTERNAL_INTROSPECTION_URI`](#oauth_external_introspection_uri). Must use `https` unless the
host is loopback. See
[Use your own identity provider](#use-your-own-identity-provider-self-hosted-only).

- Only RS, PS, ES, and EdDSA signatures are accepted. HS and `none` tokens are rejected.
- `exp` and `nbf` allow 5 seconds of clock skew.
- `iss`, `sub`, `aud`, `exp`, and `iat` must be present.
- Keys are cached and fetched again when a token names an unknown key ID (`kid`).

<hr />

### `OAUTH_EXTERNAL_DISCOVERY`

When `true`, the MCP server reads your identity provider's
[OpenID Connect discovery document](https://openid.net/specs/openid-connect-discovery-1_0.html) at
`OAUTH_ISSUER` + `/.well-known/openid-configuration` (without a doubled `/` if the issuer ends in
one). It then accepts JWTs signed by a key from the document's `jwks_uri`, with the same checks as
[`OAUTH_EXTERNAL_JWKS_URI`](#oauth_external_jwks_uri). Set only one of this,
[`OAUTH_EXTERNAL_JWKS_URI`](#oauth_external_jwks_uri), or
[`OAUTH_EXTERNAL_INTROSPECTION_URI`](#oauth_external_introspection_uri). See
[Accept OpenID Connect ID tokens](#accept-openid-connect-id-tokens).

- Default: `false`. Any value other than `true` leaves it off.
- [`OAUTH_ISSUER`](#oauth_issuer) must use `https` unless the host is loopback, and must not contain
  a username or password.
- The document is read on the first request, then kept for the life of the process. If your provider
  moves its `jwks_uri`, restart the MCP server. If the read fails, the request is rejected and the
  next request tries again.
- The document's `issuer` must equal `OAUTH_ISSUER` exactly, including any trailing slash.
- `jwks_uri` must use `https` unless both its host and the `OAUTH_ISSUER` host are loopback. It can
  be on another host than the issuer.
- If your provider doesn't serve the document at that path, set
  [`OAUTH_EXTERNAL_JWKS_URI`](#oauth_external_jwks_uri) instead.

<hr />

### `OAUTH_EXTERNAL_INTROSPECTION_URI`

The token introspection endpoint ([RFC 7662](https://www.rfc-editor.org/rfc/rfc7662)) of your
identity provider. When set, the MCP server sends each access token to this endpoint to check it.
Set only one of this, [`OAUTH_EXTERNAL_JWKS_URI`](#oauth_external_jwks_uri), or
[`OAUTH_EXTERNAL_DISCOVERY`](#oauth_external_discovery). Must use `https` unless the host is
loopback.

<hr />

### `OAUTH_EXTERNAL_INTROSPECTION_CLIENT_ID`

The client ID the MCP server uses to call
[`OAUTH_EXTERNAL_INTROSPECTION_URI`](#oauth_external_introspection_uri) with HTTP Basic auth.
Required when that variable is set.

<hr />

### `OAUTH_EXTERNAL_INTROSPECTION_CLIENT_SECRET`

The client secret for
[`OAUTH_EXTERNAL_INTROSPECTION_CLIENT_ID`](#oauth_external_introspection_client_id). Required when
[`OAUTH_EXTERNAL_INTROSPECTION_URI`](#oauth_external_introspection_uri) is set.

<hr />

### `OAUTH_EXTERNAL_USERNAME_CLAIM_NAME`

The name of the token claim to use as the Tableau username. The claim's value must be a non-empty
string, or a whole number from 0 to 9007199254740991, which is used as its decimal string. In a JWT,
`sub` itself must be a non-empty string, so a number works only in a custom username claim.
Surrounding spaces in the name are trimmed, and an empty name falls back to `sub`.

- Default: `sub`

<hr />

### `SESSION_STORE_PROVIDER`

The session store provider to use for the embedded OAuth authorization server's session state
(pending authorizations, authorization codes, refresh tokens, and OAuth client registrations).
Only relevant when [`AUTH`](env-vars#auth) is `oauth` with the embedded authorization server
enabled (the default; see [`OAUTH_EMBEDDED_AUTHZ_SERVER`](#oauth_embedded_authz_server) above).

- Default: `memory`
- Possible values:
  - `memory` - In-memory session store (default). State is process-local and does not survive a
    restart or a multi-replica deployment.
  - `custom` - Load a custom session store provider from a user-specified module, backed by
    external infrastructure (e.g. Redis, a database, or blob storage) so session state survives
    restarts and is shared across replicas.

:::tip[Custom Provider]

To use a custom session store provider, set `SESSION_STORE_PROVIDER=custom` and provide the module
path via `SESSION_STORE_PROVIDER_CONFIG`:

```bash
SESSION_STORE_PROVIDER=custom
SESSION_STORE_PROVIDER_CONFIG='{"module":"./my-session-store.js"}'
```

The custom provider module should export a default class or named export `SessionStore` that
implements the [`SessionStore`](https://github.com/tableau/tableau-mcp/blob/main/src/sessionStore/sessionStore.ts)
interface. `consume` must be implemented as a truly atomic operation against the backing store
(e.g. an ETag-based conditional write for S3/blob storage, a Lua script or `MULTI`/`EXEC` for
Redis, or a transaction for a relational store).

:::

<hr />

### `SESSION_STORE_PROVIDER_CONFIG`

Configuration for custom session store providers (JSON string).

- Required when: `SESSION_STORE_PROVIDER` is `custom`
- Format: `{"module": "<path-to-module>", ...additional-config}`

The `module` field can be:
- A relative file path (e.g., `./my-provider.js`) - resolved from process working directory
- An absolute file path (e.g., `/path/to/provider.js`)
- An npm package name (e.g., `@company/session-store-provider`)

**Example:**
```bash
SESSION_STORE_PROVIDER_CONFIG='{"module":"./providers/redis-session-store.js"}'
```

<hr />

### `ADVERTISE_API_SCOPES`

Include Tableau API scopes in OAuth metadata and scope challenges.

- Default: `false`
- When `true`, `scopes_supported` includes MCP + API scopes and scope challenges may include API
  scopes for step-up.

<hr />

### `OAUTH_AUTHORIZATION_CODE_TIMEOUT_MS`

The timeout for the OAuth authorization codes.

- Default: 10 seconds.
- Max: 1 hour.

<hr />

### `OAUTH_ACCESS_TOKEN_TIMEOUT_MS`

The timeout for the OAuth access tokens.

- Default: 1 hour.
- Max: 30 days.

<hr />

### `OAUTH_REFRESH_TOKEN_TIMEOUT_MS`

:::warning

OAuth support is currently in beta, and the present implementation retains refresh tokens in memory.
Consequently, a server administrator's action of stopping and restarting the server, potentially
during an upgrade, will result in the loss of all refresh tokens.

Any access tokens actively utilized by MCP clients will remain functional until their expiration,
but subsequent attempts to refresh these tokens will fail, requiring the user to sign out and then
sign back in.

This issue also pertains to authorization codes, though its impact is less likely due to their
significantly shorter expiration window. This limitation will be addressed in a later release.

:::

The timeout for the OAuth refresh tokens.

- Default: 30 days.
- Max: 1 year.

<hr />

### `DANGEROUSLY_DISABLE_OAUTH`

:::warning

When `TRANSPORT` is `http`, the default behavior changes to require protecting your MCP server with
OAuth as a security best practice.

To opt out of this behavior at your own risk, set `DANGEROUSLY_DISABLE_OAUTH` to `true`.

This is not recommended as your MCP server will not be protected from unauthorized access. By
explicitly disabling OAuth, you accept any and all risks associated with this decision.

:::

- Default: `false`

<hr />

## Sequence Diagram

```mermaid
sequenceDiagram
    participant Client as MCP Client<br/>(Claude/Cursor/VS Code)
    participant MCP as MCP Server<br/>(OAuth Provider)
    participant Tableau as Tableau Server<br/>(OAuth Authorization Server)
    participant User as User<br/>(Browser)

    Note over Client, User: MCP OAuth 2.1 Authentication Flows

    %% Step 1: Initial Request (401 Unauthorized)
    Client->>MCP: 1. Request to protected resource<br/>(no Bearer token)
    MCP->>Client: 2. 401 Unauthorized<br/>WWW-Authenticate: Bearer realm="MCP",<br />resource_metadata="/.well-known/oauth-protected-resource"

    %% Step 2: Resource Metadata Discovery
    Client->>MCP: 3. GET /.well-known/oauth-protected-resource
    MCP->>Client: 4. Resource metadata<br/>{resource, authorization_servers, bearer_methods_supported}

    %% Step 3: Authorization Server Metadata
    Client->>MCP: 5. GET /.well-known/oauth-authorization-server
    MCP->>Client: 6. Authorization server metadata<br/>{issuer, authorization_endpoint, token_endpoint,<br/>registration_endpoint, response_types_supported, etc.}

    %% Step 4: Dynamic Client Registration (Optional)
    Client->>MCP: 7. POST /oauth2/register<br/>{redirect_uris}
    MCP->>Client: 8. Client registration response<br/>{client_id, redirect_uris,<br/>grant_types, response_types, token_endpoint_auth_method}

    %% Choose Authentication Flow
    Note over Client: Client chooses authentication method

    %% Authorization Code Flow (User Authentication Required)
    alt Authorization Code Flow (Interactive)
        rect rgb(240, 248, 255)
            Note over Client, User: Authorization Code Flow (User Authentication Required)

            %% Step 5: Authorization Request with PKCE
            Note over Client:Generate code_verifier and code_challenge (S256)
            Client->>MCP: 9. GET /oauth2/authorize?<br/>client_id=...<br />&redirect_uri=...<br />&response_type=code<br/>&code_challenge=...<br/>&code_challenge_method=S256<br/>&state=...

            Note over MCP: Generate tableauState, authKey<br/>Store pending authorization<br/>Generate tableauClientId
            MCP->>Tableau: 10. Redirect to Tableau OAuth<br/>GET /oauth2/v1/auth?<br/>client_id=...<br/>&code_challenge=...<br/>&response_type=code<br/>&redirect_uri=/Callback<br/>&state=...<br/>&device_id=...<br/>&target_site=...<br/>&device_name=...<br/>&client_type=tableau-mcp

            %% User Authorization
            Tableau->>User: 11. OAuth login page
            User->>Tableau: 12. Enter credentials & authorize
            Tableau->>MCP: 13. Redirect to /Callback<br/>?code=tableauAuthZCode<br/>&state=...

            %% Step 6: OAuth Callback
            Note over MCP: Validate state parameter<br/>Exchange Tableau authz code for tokens<br/>Get user session info
            MCP->>Tableau: 14. POST /oauth2/v1/token<br/>{grant_type: "authorization_code",<br/>code: tableauAuthZCode,<br/>redirect_uri: /Callback,<br/>client_id: "...",<br/>code_verifier: "S256"}
            Tableau->>MCP: 15. Token response<br/>{access_token, refresh_token, expires_in, origin_host}

            Note over MCP: get server session to verify authentication
            MCP->>Tableau: 16. GET /api/3.26/sessions/current

            Note over MCP: Generate MCP authorization code<br/>Store authorization code with user info & tokens
            MCP->>Client: 17. Redirect to client callback<br/>?code=mcpAuthCode<br/>&state=originalState

            %% Step 7: Token Exchange with PKCE Verification
            Client->>MCP: 18. POST /oauth2/token<br/>{grant_type: "authorization_code",<br/>code: mcpAuthCode,<br/>redirect_uri: ...,<br/>code_verifier: originalCodeVerifier,<br/>client_id: ...}

            Note over MCP: Verify PKCE code_verifier<br/>Generate JWE access token<br/>Store refresh token
            MCP->>Client: 19. Token response<br/>{access_token: JWE,<br />token_type: "Bearer",<br/>expires_in: ...,<br />refresh_token: ...,<br/>scope: "read"}
        end
    else Client Credentials Flow (Non-Interactive)
        rect rgb(255, 248, 240)
            Note over Client, MCP: Client Credentials Flow (No User Authentication Required)

            %% Direct Token Request
            Client->>MCP: 9. POST /oauth2/token<br/>{grant_type: "client_credentials",<br/>client_id: "clientId",<br/>client_secret: "secret"}

            Note over MCP: Verify client credentials<br/>Generate JWE access token<br/>(No refresh token issued)
            MCP->>Client: 10. Token response<br/>{access_token: JWE,<br/>token_type: "Bearer",<br/>expires_in: ...,<br/>scope: "read"}

            Note over Client, MCP: Alternative: Authorization Header
            Client->>MCP: 11. POST /oauth2/token<br/>{grant_type: "client_credentials"}<br/>Authorization: Basic Y2xpZW50SWQ6c2VjcmV0
            MCP->>Client: 12. Token response<br/>{access_token: JWE,<br/>token_type: "Bearer",<br/>expires_in: ...,<br/>scope: "read"}
        end
    end

    %% Step 8: Authenticated MCP Requests
    Note over Client, MCP: Client can now make authenticated requests
    Client->>MCP: 20. Request to protected resource<br/>Authorization: Bearer JWE_TOKEN
    Note over MCP: Decrypt JWE, validate JWT<br/>Extract Tableau tokens & user info (if auth_code)<br/>or use configured auth method (if client_credentials)
    MCP->>Tableau: 21. API call using Tableau access token<br/>or configured auth method
    Tableau->>MCP: 22. API response
    MCP->>Client: 23. MCP response with data

    %% Token Refresh Flow (Authorization Code only)
    alt Token Refresh (Authorization Code Grant Only)
        rect rgb(248, 255, 248)
            Note over Client, MCP: Token Refresh Flow
            Client->>MCP: 24. POST /oauth2/token<br/>{grant_type: "refresh_token",<br/>refresh_token: refreshTokenId}
            Note over MCP: Validate refresh token<br/>Try to refresh Tableau tokens<br/>Generate new JWE access token
            MCP->>Tableau: 25. POST /oauth2/v1/token<br/>{grant_type: "refresh_token",<br/>refresh_token: ...,<br/>client_id: ...}
            Tableau->>MCP: 26. New token response (or error)
            MCP->>Client: 27. New access token or error
        end
    end

    %% Error Handling
    Note over Client, MCP: Error scenarios
    alt Invalid/Expired Token
        Client->>MCP: Request with invalid token
        MCP->>Client: 401 Unauthorized<br/>{error: "invalid_token"}
        Note over Client: Client should refresh token or re-authenticate
    end

    alt Invalid Client Credentials
        Client->>MCP: POST /oauth2/token with invalid credentials
        MCP->>Client: 401 Unauthorized<br/>{error: "invalid_client"}
        Note over Client: Client should check credentials
    end

    alt Tableau API Error
        MCP->>Tableau: API call
        Tableau->>MCP: Error response
        MCP->>Client: Error response with details
    end
```

### Key Components

#### Grant Types

The MCP server supports three OAuth 2.1 grant types:

1. **Authorization Code Grant** (with PKCE): Interactive flow requiring user authentication
   - User must authenticate with Tableau Server
   - Supports refresh tokens for long-term access
   - Uses PKCE for security
   - Suitable for interactive applications

2. **Client Credentials Grant**: Non-interactive flow for service-to-service authentication
   - No user authentication required
   - No refresh tokens issued
   - Uses pre-configured client ID/secret pairs
   - Suitable for automated systems and APIs

3. **Refresh Token Grant**: Used to obtain new access tokens
   - Only available for authorization code grants
   - Automatically refreshes Tableau tokens when possible
   - Falls back to existing tokens if refresh fails

#### Security Features

- **PKCE (RFC 7636)**: Code challenge/verifier for public clients (authorization code only)
- **JWE Encryption**: Access tokens encrypted with RSA-OAEP-256/A256GCM
- **State Validation**: Prevents CSRF attacks (authorization code only)
- **Time-limited Tokens**: Authorization codes (10 seconds), access tokens (1 hour), refresh tokens
  (30 days)
- **Client Credential Verification**: Secure comparison using timing-safe operations

#### Token Types

1. **Tableau OAuth Tokens**: Direct from Tableau Server (authorization code only)
2. **MCP Authorization Code**: Short-lived code for token exchange (authorization code only)
3. **MCP Access Token**: JWE-encrypted token containing Tableau credentials or client info
4. **MCP Refresh Token**: For obtaining new access tokens (authorization code only)

#### Endpoints

- `/.well-known/oauth-protected-resource`: Resource metadata discovery
- `/.well-known/oauth-authorization-server`: Authorization server metadata
- `/oauth2/register`: Dynamic client registration
- `/oauth2/authorize`: Authorization endpoint with PKCE (authorization code only)
- `/Callback`: OAuth callback handler (authorization code only)
- `/oauth2/token`: Token exchange and refresh (all grant types)
- `/oauth2/revoke`: Token revocation

For MCP client-facing token and consent cleanup, see the
[`reset-consent`](../../tools/token-management/reset-consent.md) and
[`revoke-access-token`](../../tools/token-management/revoke-access-token.md) tools. For full
cleanup, call `reset-consent` before `revoke-access-token`.
