---
sidebar_position: 5
---

# Passthrough Authentication

With passthrough authentication enabled, authentication to the MCP server acts similarly to the
Tableau REST APIs. The same
[`X-Tableau-Auth` header](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_auth.htm#using_auth_token)
used to authenticate to the Tableau REST APIs can also used to authenticate to the MCP server.

When a request is made to the MCP server, the `X-Tableau-Auth` header is read.

- When the header is present, the value will be "passed through" and re-used during MCP tool calls
  when they authenticate to the Tableau REST APIs.
- When absent, normal authentication will resume as defined by the [`AUTH`](../env-vars.md#auth)
  environment variable. This allows clients that do not provide the `X-Tableau-Auth` header to still
  authenticate to the MCP server.

:::warning

When using passthrough authentication, the calling application is responsible for creating the
credential for the `X-Tableau-Auth` header and managing its lifecycle. The MCP server will not
automatically terminate the Tableau session associated with the credential after its use nor will it
refresh it after it expires. Providing an invalid or expired credential will result in downstream
authentication failures.

Additionally, if [`OAuth`](oauth.md) is enabled, all requests to the MCP server must include the
`X-Tableau-Auth` header, otherwise the client will be considered unauthorized and will be forced to
authenticate using OAuth. This even includes MCP lifecycle requests like the
[Initialization request](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle#initialization),
even though it does not make any downstream Tableau REST API calls.

:::

:::danger

Do not use a Personal Access Token (PAT) to generate the `X-Tableau-Auth` credential when when using
passthrough authentication since PATs cannot be used concurrently. Signing in multiple times with
the same PAT at the same time will terminate any prior session and will result in an authentication
error. See
[Understand personal access tokens](https://help.tableau.com/current/server/en-us/security_personal_access_tokens.htm#understand-personal-access-tokens)
for more details.

:::

## ENABLE_PASSTHROUGH_AUTH

- Default: `false`
- When `true`, passthrough authentication is enabled.
- Only applies when [`TRANSPORT`](../env-vars.md#transport) is `http`.
