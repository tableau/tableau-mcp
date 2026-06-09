---
sidebar_position: 1
---

# Reset Consent

Resets saved OAuth consent for the current user on the Tableau authorization server.

Use `reset-consent` when you need to clear previously granted OAuth consent so the next OAuth
authorization flow prompts the user for consent again. This is the canonical documentation page to
link to when a consent experience needs to tell users how to reset previously granted access for MCP.

For full OAuth cleanup, call `reset-consent` before
[`revoke-access-token`](revoke-access-token.md). `reset-consent` needs the current valid bearer token;
revoking the token first invalidates the credential needed to reset consent.

## Arguments

This tool requires no input. It operates on the authentication context already associated with the
MCP request. Raw access tokens, refresh tokens, JWE tokens, and bearer values are never exposed to
the model.

## Supported Auth Modes

- **Bearer authentication with Tableau authorization server mode**: supported. The tool calls
  `/oauth2/resetConsent` on the configured OAuth issuer using the current bearer token.

## Unsupported Modes And Limitations

- **Embedded authorization server mode**: disabled. The embedded authorization server does not use
  the same consent model.
- **Passthrough authentication and other non-Bearer auth modes**: not supported. Session credentials
  are managed externally.

## Side Effects

The current session remains valid, but the next OAuth authorization flow re-prompts the user for
consent.
