---
sidebar_position: 5
---

# Passthrough Authentication

With passthrough authentication enabled, authentication to the MCP server acts similarly to the
Tableau REST APIs. The same
[`X-Tableau-Auth` header](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_auth.htm#using_auth_token)
used to authenticate to the Tableau REST APIs can also be used to authenticate to the MCP server.

When a request is made to the MCP server, the `X-Tableau-Auth` header is read.

- When the header is present, the value will be "passed through" and re-used during MCP tool calls
  when they authenticate to the Tableau REST APIs.
- When absent, behavior depends on how passthrough was enabled:
  - With [`ENABLE_PASSTHROUGH_AUTH`](#enable_passthrough_auth) set to `true`, normal authentication
    resumes as defined by the [`AUTH`](../env-vars.md#auth) environment variable. This allows clients
    that do not provide the `X-Tableau-Auth` header to still authenticate to the MCP server.
  - With [`AUTH`](../env-vars.md#auth) set to `passthrough`, there is no fallback: the request is
    rejected with `401 invalid_token`.

## Warnings

### Credential Lifecycle

:::warning

When using passthrough authentication, the calling application is responsible for creating the
credential for the `X-Tableau-Auth` header and managing its lifecycle. The MCP server will not
automatically terminate the Tableau session associated with the credential after its use nor will it
refresh it after it expires. Providing an invalid or expired credential will result in downstream
authentication failures.

:::

### JWT Scopes

:::warning

If you
[use a JWT to create the auth token](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_auth.htm#make-a-sign-in-request-with-jwt),
it must contain the Tableau scopes needed by the underlying REST APIs called by the MCP tools. For
the full list of scopes and which are used by each individual tool, please refer to
[scopes.ts](https://github.com/tableau/tableau-mcp/blob/main/src/server/oauth/scopes.ts).

In versions of Tableau older than 2026.2, the JWT must also contain the `tableau:*:*` scope.

:::

### OAuth

:::warning

If [`OAuth`](oauth.md) is enabled, **all** requests to the MCP server must include the
`X-Tableau-Auth` header, otherwise the client will be considered unauthorized and will be forced to
authenticate using OAuth. This even includes MCP lifecycle requests like the
[Initialization request](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#initialization),
even though it does not make any downstream Tableau REST API calls.

:::

### Personal Access Tokens

:::danger

Do not use a Personal Access Token (PAT) to generate the `X-Tableau-Auth` credential when using
passthrough authentication since PATs cannot be used concurrently. Signing in multiple times with
the same PAT at the same time will terminate any prior session and will result in an authentication
error. See
[Understand personal access tokens](https://help.tableau.com/current/server/en-us/security_personal_access_tokens.htm#understand-personal-access-tokens)
for more details.

:::

## Environment Variables

### AUTH

- Setting [`AUTH`](../env-vars.md#auth) to `passthrough` enables passthrough authentication and makes
  it the only accepted method: every request must carry an `X-Tableau-Auth` token, and requests
  without one are rejected with `401 invalid_token`.
- Implies [`ENABLE_PASSTHROUGH_AUTH`](#enable_passthrough_auth) is `true`; you do not need to set both.
- Unlike `ENABLE_PASSTHROUGH_AUTH`, there is no fallback to another `AUTH` method when the header is
  absent.

<hr />

### ENABLE_PASSTHROUGH_AUTH

- Default: `false`
- When `true`, passthrough authentication is enabled, falling back to the [`AUTH`](../env-vars.md#auth)
  method when the `X-Tableau-Auth` header is absent.
- Only applies when [`TRANSPORT`](../env-vars.md#transport) is `http`.

<hr />

### PASSTHROUGH_AUTH_USER_SESSION_CHECK_INTERVAL_IN_MINUTES

- Default: `10` minutes
- How often the server re-checks that a passthrough auth token is still valid. Between checks,
  recently validated tokens are trusted without re-verification. Downstream requests to the Tableau
  REST APIs could potentially fail if the token was invalidated during this interval.
- Valid range: `0` to `1440` (24 hours). Use `0` to verify the token on every request.
