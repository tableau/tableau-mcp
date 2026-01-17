---
sidebar_position: 4
---

# Enabling OAuth

:::warning

Tableau Server 2025.3+ only. Full Tableau Cloud is not supported yet but is coming soon ETA Q2 2026.
Until then, enabling OAuth support against a Tableau Cloud site will only work when the MCP server
is accessed using a local development URL e.g. `http://127.0.0.1:3927/tableau-mcp`.

:::

## How to Enable OAuth

To enable OAuth, set the [`OAUTH_ISSUER`](#oauth_issuer) environment variable to the URL of your MCP server. When a URL for `OAUTH_ISSUER` is provided, the MCP server will act as an OAuth 2.1 resource server, capable of accepting and responding to protected resource requests using encrypted access tokens.

When OAuth is enabled:
- MCP clients will be required to authenticate via Tableau OAuth before connecting to the MCP server
- The [`TRANSPORT`](#transport) will default to `http` (required for OAuth)
- The [`AUTH`](#auth) method will default to `oauth`

For more information, please see the
[MCP Authorization spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization).

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

**Setting this environment variable enables OAuth.** This should be the URL of your MCP server (the issuer of access tokens).

- Example: `http://127.0.0.1:3927` (for local testing) or `https://tableau-mcp.example.com` (for production)
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

### `TRUST_PROXY_CONFIG`

:::warning

In our internal testing, setting `TRUST_PROXY_CONFIG` to `1` was required when OAuth is enabled and
the MCP server is deployed to Heroku. Otherwise, some MCP clients may not be able to connect to the
MCP server.

See [TRUST_PROXY_CONFIG](http-server#trust_proxy_config) for details.

:::

<hr />

### `OAUTH_CLIENT_ID_SECRET_PAIRS`

A comma-separated list of client ID and secret pairs to be used for OAuth clients that require the
use of the client credentials grant type.

- Optional.
- Example: `client1:secret1,client2:secret2`
- Client IDs and secrets must be unique and cannot contain colons or commas.
- The `/oauth/token` endpoint accepts client credentials in the request body or the authorization
  header. If both are provided, the request body takes precedence.
- When an access token is requested with the client credentials grant type:
  - No refresh token is issued to the client.
  - `AUTH` must not be set to `oauth` since there is no Tableau user associated with the access
    token. The user context must come from the user who owns the
    [Personal Access Token](authentication/pat) or from the value of the
    [`JWT_SUB_CLAIM`](authentication/direct-trust#jwt_sub_claim) environment variable.

Example `/oauth/token` request body:

```json
{
  "grant_type": "client_credentials",
  "client_id": "clientId",
  "client_secret": "secret"
}
```

Example `/oauth/token` request header:

```
Authorization: Basic Y2xpZW50SWQ6c2VjcmV0
```

Where `Y2xpZW50SWQ6c2VjcmV0` is the base64 encoding of `clientId:secret`.

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
    Client->>MCP: 7. POST /oauth/register<br/>{redirect_uris}
    MCP->>Client: 8. Client registration response<br/>{client_id, redirect_uris,<br/>grant_types, response_types, token_endpoint_auth_method}

    %% Choose Authentication Flow
    Note over Client: Client chooses authentication method

    %% Authorization Code Flow (User Authentication Required)
    alt Authorization Code Flow (Interactive)
        rect rgb(240, 248, 255)
            Note over Client, User: Authorization Code Flow (User Authentication Required)

            %% Step 5: Authorization Request with PKCE
            Note over Client:Generate code_verifier and code_challenge (S256)
            Client->>MCP: 9. GET /oauth/authorize?<br/>client_id=...<br />&redirect_uri=...<br />&response_type=code<br/>&code_challenge=...<br/>&code_challenge_method=S256<br/>&state=...

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
            Client->>MCP: 18. POST /oauth/token<br/>{grant_type: "authorization_code",<br/>code: mcpAuthCode,<br/>redirect_uri: ...,<br/>code_verifier: originalCodeVerifier,<br/>client_id: ...}

            Note over MCP: Verify PKCE code_verifier<br/>Generate JWE access token<br/>Store refresh token
            MCP->>Client: 19. Token response<br/>{access_token: JWE,<br />token_type: "Bearer",<br/>expires_in: ...,<br />refresh_token: ...,<br/>scope: "read"}
        end
    else Client Credentials Flow (Non-Interactive)
        rect rgb(255, 248, 240)
            Note over Client, MCP: Client Credentials Flow (No User Authentication Required)

            %% Direct Token Request
            Client->>MCP: 9. POST /oauth/token<br/>{grant_type: "client_credentials",<br/>client_id: "clientId",<br/>client_secret: "secret"}

            Note over MCP: Verify client credentials<br/>Generate JWE access token<br/>(No refresh token issued)
            MCP->>Client: 10. Token response<br/>{access_token: JWE,<br/>token_type: "Bearer",<br/>expires_in: ...,<br/>scope: "read"}

            Note over Client, MCP: Alternative: Authorization Header
            Client->>MCP: 11. POST /oauth/token<br/>{grant_type: "client_credentials"}<br/>Authorization: Basic Y2xpZW50SWQ6c2VjcmV0
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
            Client->>MCP: 24. POST /oauth/token<br/>{grant_type: "refresh_token",<br/>refresh_token: refreshTokenId}
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
        Client->>MCP: POST /oauth/token with invalid credentials
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
- `/oauth/register`: Dynamic client registration
- `/oauth/authorize`: Authorization endpoint with PKCE (authorization code only)
- `/Callback`: OAuth callback handler (authorization code only)
- `/oauth/token`: Token exchange and refresh (all grant types)
