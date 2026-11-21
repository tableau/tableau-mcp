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
