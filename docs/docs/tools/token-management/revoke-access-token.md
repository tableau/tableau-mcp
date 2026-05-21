---
sidebar_position: 2
---

# Revoke Access Token

Revokes the access token used to authenticate the current MCP session.

Use `revoke-access-token` when signing a user out of the MCP session, revoking access after
suspicious activity, or performing clean session teardown from an MCP client or orchestration layer.

For full OAuth cleanup, call [`reset-consent`](reset-consent.md) before `revoke-access-token`.
Revocation invalidates the token required to authenticate the consent reset request.

## Arguments

This tool requires no input. It operates on the authentication context already associated with the
MCP request. Raw access tokens, refresh tokens, JWE tokens, and bearer values are never exposed to
the model.

## Supported Auth Modes

- **Bearer authentication with Tableau authorization server mode**: supported. The tool submits the
  current Tableau access token to the issuer's `/oauth2/revoke` endpoint.
- **X-Tableau-Auth in embedded authorization server mode**: supported. The tool submits the current
  MCP JWE access token to the embedded revocation endpoint, which handles Tableau signout and refresh
  token cleanup.

## Unsupported Modes And Limitations

- **Passthrough authentication**: not supported. Session credentials are managed externally.
- Revocation can fail if the authorization server rejects the request, or if the token is already
  expired or invalid.

## Side Effects

The current session or token is revoked. Subsequent Tableau API calls in the same session may fail.
After calling this tool, clients should disconnect from the MCP server and reconnect if they need a
new authenticated session.
