---
sidebar_position: 1
---

# Reset Consent

{/* availability */}
<span className="toolAvailability">Available June 2026 and later.</span>
{/* /availability */}

Resets saved OAuth consent for the current user on the Tableau authorization server. Use
`reset-consent` when you need to clear previously granted OAuth consent so the next OAuth
authorization flow prompts the user for consent again. This is the canonical documentation page to
link to when a consent experience needs to tell users how to reset previously granted access for MCP.

The tool requires no input — it operates on the authentication context already associated with the
MCP request, and raw access tokens, refresh tokens, JWE tokens, and bearer values are never exposed
to the model. For full OAuth cleanup, call `reset-consent` before
[`revoke-access-token`](revoke-access-token.md): the reset needs the current valid bearer token, so
revoking the token first invalidates the credential required to reset consent.


:::warning[Tableau Authorization Server Only]
Registered only when OAuth is enabled against an external Tableau authorization server — that is,
[`OAUTH_ISSUER`](../../configuration/mcp-config/oauth.md#oauth_issuer) is set and
[`OAUTH_EMBEDDED_AUTHZ_SERVER`](../../configuration/mcp-config/oauth.md#oauth_embedded_authz_server)
is `false`. The embedded authorization server does not use the same consent model, so the tool is
not registered in that mode.
:::

## APIs called

This tool does **not** call the Tableau REST API. It sends a single request to the configured OAuth
authorization server (the OAuth issuer), authenticated with the current session's bearer access
token over the `Authorization` header. No OAuth scopes are required — any authenticated user may
reset their own consent regardless of the scopes their token was granted.

- Clear the current user's saved OAuth consent so the next authorization flow re-prompts for
  consent.
  - `POST {OAUTH_ISSUER}/oauth2/resetConsent` — reset the stored consent on the Tableau
    authorization server. Issued against the configured OAuth issuer (not the Tableau REST API);
    authorized by the current session's Bearer access token, with no OAuth scope requirement.

## Notes and caveats

- Consent reset is available **only** for Bearer authentication in Tableau authorization server
  mode. Under passthrough authentication or any other non-Bearer auth mode the tool returns an
  error, because those session credentials are managed externally.
- The current session remains valid after a successful reset; only the saved consent is cleared, so
  the next OAuth authorization flow re-prompts the user for consent.
- If the authorization server rejects the request, the tool reports the failure with the returned
  HTTP status.

## Example result

```json
{
  "type": "success",
  "result": "Consent has been reset. The next authorization flow will re-prompt for consent."
}
```

## Related

- [`revoke-access-token`](revoke-access-token.md) — revoke the current session's access token; call
  `reset-consent` first, since revocation invalidates the token needed to reset consent

{/* tool-details */}
## Supported Auth Modes

- **Bearer authentication with Tableau authorization server mode**: supported. The tool calls
  `/oauth2/resetConsent` on the configured OAuth issuer using the current bearer token.

## Unsupported Modes And Limitations

- **Embedded authorization server mode**: disabled. The embedded authorization server does not use
  the same consent model.
- **Passthrough authentication and other non-Bearer auth modes**: not supported. Session credentials

## Side Effects

The current session remains valid, but the next OAuth authorization flow re-prompts the user for
consent.
{/* /tool-details */}
