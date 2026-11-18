---
sidebar_position: 2
---

# Revoke Access Token

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Revokes the access token used to authenticate the current MCP session. Use it when signing a user
out of the MCP session, revoking access after suspicious activity, or performing a clean session
teardown from an MCP client or orchestration layer.

This tool takes no arguments — it operates on the authentication context already associated with the
MCP request, and never exposes raw access tokens, refresh tokens, JWE tokens, or bearer values to the
model. Revocation is destructive: once the token is revoked, subsequent Tableau API calls in the same
session may fail.

For full OAuth cleanup, call [`reset-consent`](reset-consent.md) before `revoke-access-token` —
revoking the token first invalidates the credential needed to authenticate the consent reset request.

:::note[OAuth Only]
Registered only when [`AUTH`](../../configuration/mcp-config/env-vars.md#auth)`=oauth`.
:::

## Access requirements

- **User/site role:** `Viewer` or higher in the MCP role hierarchy; Tableau content
  permissions and site capabilities also apply.
- **Declared registration minimum:** `Viewer`. See [role enforcement](../overview.md#role-enforcement)
  for when this filters the tool list and which roles qualify.

## APIs called

This tool does not call the Tableau REST API to read or list content. It submits the current session
token to the OAuth 2.0 token revocation endpoint (`/oauth2/revoke`, per RFC 7009) on the configured
OAuth issuer, and the exact issuer and payload depend on the session's auth mode. No OAuth scope is
required — any authenticated user may revoke their own token regardless of granted scopes.

- **Bearer authentication (Tableau authorization server mode)** — submits the raw Tableau access
  token to the Tableau authorization server's revocation endpoint. The session's OAuth `client_id`
  must be resolvable from the request context.
  - `POST /oauth2/revoke` — revoke the current Tableau access token. Issued against the Tableau
    authorization server (the configured OAuth issuer); the form-encoded body carries the token and
    the session's OAuth `client_id`. No OAuth scope required. [OAuth 2.0 Token Revocation (RFC 7009)](https://datatracker.ietf.org/doc/html/rfc7009)
- **X-Tableau-Auth (embedded authorization server mode)** — submits the current MCP JWE access token
  to this MCP server's own embedded revocation endpoint, which decrypts it, signs the user out of
  Tableau, and deletes the associated refresh token.
  - `POST /oauth2/revoke` — revoke the MCP session token. Issued against this MCP server's embedded
    authorization server; the JSON body carries the token and `token_type_hint: access_token`. No
    OAuth scope required. [OAuth 2.0 Token Revocation (RFC 7009)](https://datatracker.ietf.org/doc/html/rfc7009)
  - `POST /auth/signout` — sign the user out of Tableau (performed by the embedded authorization
    server, not the tool). Issued against the Tableau REST API. [Sign Out](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_authentication.htm#sign_out)

## Notes and caveats

- Passthrough authentication is not supported: session credentials are managed externally, so the
  tool returns an error (HTTP 400) instead of revoking.
- In Bearer mode the session's OAuth `client_id` must be resolvable from the request context; if it
  cannot be determined, the tool returns an error (HTTP 400) without calling the authorization server.
- Revocation can fail if the authorization server rejects the request, or if the token is already
  expired or invalid; the tool reports the authorization server's HTTP status.
- After a successful revocation, clients should disconnect from the MCP server and reconnect to
  establish a new authenticated session.

## Example result

```json
{
  "type": "success",
  "result": "Access token has been submitted for revocation. Subsequent Tableau API calls may fail."
}
```

## Related

- [`reset-consent`](reset-consent.md) — reset saved OAuth consent on the Tableau authorization
  server; call it before `revoke-access-token` for full OAuth cleanup.

{/* tool-details */}
## Availability

This tool is only registered when `AUTH=oauth`. It is unavailable for other authentication types (`pat`, `uat`, `direct-trust`).

## Supported Auth Modes

- **Bearer authentication with Tableau authorization server mode**: supported. The tool submits the
  current Tableau access token to the issuer's `/oauth2/revoke` endpoint.
- **X-Tableau-Auth in embedded authorization server mode**: supported. The tool submits the current
  MCP JWE access token to the embedded revocation endpoint, which handles Tableau signout and refresh
  token cleanup.

## Unsupported Modes And Limitations

- **Passthrough authentication**: not supported. Session credentials are managed externally.

## Side Effects

The current session or token is revoked. Subsequent Tableau API calls in the same session may fail.
{/* /tool-details */}
