---
sidebar_position: 6
---

# OAuth Cleanup Tools

Use these tools when an MCP client or orchestration layer needs to clean up OAuth state for the
current session. Both tools require no input and operate on the authentication context already
associated with the MCP request. Raw access tokens, refresh tokens, JWE tokens, and bearer values are
never exposed to the model.

For full OAuth cleanup, call [`reset-consent`](#reset-consent) before
[`revoke-access-token`](#revoke-access-token). `reset-consent` needs the current valid bearer token;
revoking the token first invalidates the credential needed to reset consent.

## `reset-consent`

Resets saved OAuth consent for the current user on the Tableau authorization server.

Use `reset-consent` when you need to clear previously granted OAuth consent so the next OAuth
authorization flow prompts the user for consent again. The current MCP session remains valid after
the tool succeeds.

### Arguments

This tool requires no input.

### Supported auth modes

- **Bearer authentication with Tableau authorization server mode**: supported. The tool calls
  `/oauth2/resetConsent` on the configured OAuth issuer using the current bearer token.

### Unsupported modes and limitations

- **Embedded authorization server mode**: disabled. The embedded authorization server does not use
  the same consent model.
- **Passthrough authentication and other non-Bearer auth modes**: not supported. Session credentials
  are managed externally.

### Side effects

The current session remains valid, but the next OAuth authorization flow re-prompts the user for
consent.

## `revoke-access-token`

Revokes the access token used to authenticate the current MCP session.

Use `revoke-access-token` when signing a user out of the MCP session, revoking access after
suspicious activity, or performing clean session teardown from an MCP client or orchestration layer.

### Arguments

This tool requires no input.

### Supported auth modes

- **Bearer authentication with Tableau authorization server mode**: supported. The tool submits the
  current Tableau access token to the issuer's `/oauth2/revoke` endpoint.
- **X-Tableau-Auth in embedded authorization server mode**: supported. The tool submits the current
  MCP JWE access token to the embedded revocation endpoint, which handles Tableau signout and refresh
  token cleanup.

### Unsupported modes and limitations

- **Passthrough authentication**: not supported. Session credentials are managed externally.
- Revocation can fail if the authorization server rejects the request, or if the token is already
  expired or invalid.

### Side effects

The current session or token is revoked. Subsequent Tableau API calls in the same session may fail.
After calling this tool, clients should disconnect from the MCP server and reconnect if they need a
new authenticated session.
