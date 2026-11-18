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
