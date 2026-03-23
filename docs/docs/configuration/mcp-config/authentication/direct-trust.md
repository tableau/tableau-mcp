---
sidebar_position: 2
---

# Direct Trust

When `AUTH` is `direct-trust`, the MCP server will use the provided [Tableau Direct Trust Connected
App][direct-trust] info to generate a scoped [JSON Web Token (JWT)][jwt] and use it to authenticate
to the Tableau REST APIs.

The generated JWT will have the minimum set of scopes necessary to invoke the methods called by the
tool being executed.

For example, for the [`query-datasource`](../../../tools/data-qna/query-datasource.md) tool, since
it internally calls into VizQL Data Service, the JWT will only have the
`tableau:viz_data_service:read` scope.

## Required Variables

### `JWT_SUB_CLAIM`

The username for the `sub` claim of the JWT.

- Can either be a hard-coded username, the OAuth username by setting it to `{OAUTH_USERNAME}` when
  MCP OAuth is enabled, or (when MCP OAuth is disabled) the username sent on each HTTP request via
  [`JWT_SUB_CLAIM_HEADER`](#jwt_sub_claim_header) below.

<hr />

### `CONNECTED_APP_CLIENT_ID`

The client ID of the Tableau Connected App.

<hr />

### `CONNECTED_APP_SECRET_ID`

The secret ID of the Tableau Connected App.

<hr />

### `CONNECTED_APP_SECRET_VALUE`

The secret value of the Tableau Connected App.

:::warning

Treat your Connected App secret value securely and do not share it with anyone or in any client-side
code where it could accidentally be revealed.

:::

<hr />

## Optional Variables

### `JWT_SUB_CLAIM_HEADER`

HTTP header your **trusted gateway** (reverse proxy, backend, etc.) adds on every MCP request with
the Tableau username to use in the JWT (same value you would put in `JWT_SUB_CLAIM` for a fixed
user). Set `JWT_SUB_CLAIM` to `{OAUTH_USERNAME}` so that value is taken from this header.

**Requirements (all must be satisfied):**

- `TRANSPORT` is `http`
- `DANGEROUSLY_DISABLE_OAUTH` is `true` (MCP OAuth off)
- `DISABLE_SESSION_MANAGEMENT` is `true` (stateless HTTP so each request can carry a different user)
- `JWT_SUB_CLAIM_HEADER_SECRET` is set (see below)

If the username header is **omitted** on a request, the server does not treat the request as
header-authenticated (a static `JWT_SUB_CLAIM` without `{OAUTH_USERNAME}` still works).

<hr />

### `JWT_SUB_CLAIM_HEADER_SECRET`

Shared secret. The client must send the same value in the header named by
`JWT_SUB_CLAIM_HEADER_SECRET_HEADER` (default `x-tableau-mcp-jwt-sub-secret`) whenever it sends the
username header. Mismatches receive HTTP 401.

<hr />

### `JWT_SUB_CLAIM_HEADER_SECRET_HEADER`

Optional. Custom HTTP header name for the secret. Must be a valid header token if set.

<hr />

### `JWT_ADDITIONAL_PAYLOAD`

A JSON string that includes any additional user attributes to include on the JWT. It also supports
dynamically including the OAuth username.

Example:

```json
{ "username": "{OAUTH_USERNAME}", "region": "West" }
```

[direct-trust]: https://help.tableau.com/current/online/en-us/connected_apps.htm#direct-trust
[jwt]: https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_authentication.htm#jwt
