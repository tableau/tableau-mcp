# Server-level External Authorization Server

Use `AUTH=server-eas` to authenticate HTTP requests with an existing JWT from the External
Authorization Server (EAS) trusted by Tableau Server. MCP submits the JWT unchanged to Tableau REST
Sign In for the configured site. Server validates it and resolves the Tableau user. Subsequent API
calls use the returned Tableau session, which MCP signs out when the request ends.

```bash
AUTH=server-eas
TRANSPORT=http
SERVER=https://tableau.example.com
SITE_NAME=example-site
OAUTH_RESOURCE_URI=https://mcp.example.com
OAUTH_GLOBAL_RESOURCE_URIS=registered-mcp-client-id
```

Set `SITE_NAME` to the site's content URL; leave it empty for the Default site. `SERVER` must use
HTTPS, with HTTP allowed only on loopback. Configure TLS or a trusted TLS-terminating proxy for
client connections to MCP. Each client request supplies `Authorization: Bearer <JWT>`.

MCP accepts the canonical audience `OAUTH_RESOURCE_URI` plus `/tableau-mcp`, or an explicitly listed
`OAUTH_GLOBAL_RESOURCE_URIS` audience. A registered OAuth client ID can be an audience alias. Only
configure audiences intended for this MCP deployment and configure Server's accepted audiences
consistently. A matching audience alone never authenticates the token: Server must accept the exact
JWT. MCP obtains the identity and site from the authenticated Server response, not decoded claims.

This mode needs no PAT, Connected App secret, local signing key, IdP discovery or Direct Trust
conversion. Remove conflicting PAT/UAT/Connected App and OAuth-provider configuration. It cannot be
combined with passthrough authentication or stdio. Neither `OAUTH_DISABLE_SCOPES` nor
`DANGEROUSLY_DISABLE_OAUTH` disables EAS authentication. Clients must obtain the JWT externally;
this mode does not implement browser login, token issuance or refresh endpoints.

## Server prerequisites

Server must support EAS JWT REST sign-in and trust the issuer and JWKS. Custom username claims,
audiences and identity-only scope fallback require the Server-wide EAS token-customization feature
and corresponding Server configuration. Configure these through Server administration; MCP does not
modify Server settings. Validate issuer interoperability for each deployment.

For example, if the issuer's `external_username` claim already equals the Tableau username, configure Server's
username claim as `external_username`. The user's site membership, role and permissions still apply. MCP does not
provision users, rewrite claims or fall back to another identity when sign-in fails.

## Tools and authorization

Server enforces the authenticated session's API scopes and user/content permissions. MCP retains
normal tool configuration (`INCLUDE_TOOLS`/`EXCLUDE_TOOLS`), feature controls and optional
registration checks. This mode does not require the external issuer to mint `tableau:mcp:*` grants
and does not reinterpret its `scope`/`scp` claims locally.

When Server's opt-in wildcard fallback is enabled, identity-only scopes such as `openid` can produce
`tableau:*` in the Tableau session. This removes API-scope restrictions, not user permissions or
site membership. Explicit selected Tableau scopes stay restricted. A registered tool can therefore
still be denied by Server. When MCP site settings are enabled (the default), explicitly narrow
tokens need `tableau:mcp_site_settings:read` when startup must fetch those settings. A Server-denied
settings read returns 403; identity-only tokens with Server wildcard fallback already cover that API
scope.

Staged workbook/data-source upload URL creation is unavailable in this mode, as with session
passthrough; it requires separate MCP authorization. Interactive embedding also requires suitable
embedding credentials, so `render-interactive-viz` is not registered in this mode and the app-only
embed-token helper reports unavailable.

## Session lifetime and failures

Each HTTP request authenticates independently and reuses its session for the request's API calls.
MCP sessions remain bound to the authenticated principal, Server and site. Returned credentials are
not cached across requests; an incoming token that expires cannot be rescued by an earlier MCP
session. Long-lived responses are bounded by the token's Server-accepted expiry.

Invalid authentication returns a generic 401. Upstream unavailability returns 503. Conflicting
session and bearer inputs return 400. No upstream error bodies or credentials are returned in these
responses. Cleanup is best effort: if a successful sign-in response is lost, or the process dies,
MCP may not have a credential it can immediately sign out. Sign-in is not automatically retried;
Server session expiry remains the fallback for those unknown outcomes.

## Development validation

After installing the repository's pinned dependencies, run:

```bash
scripts/agent-check
npm run build
npm run test:oauth:server-eas
```

The HTTP suite uses the built MCP server, the actual MCP SDK client and a loopback-only synthetic
Tableau backend. It verifies discovery/read, unchanged-token exchange, user isolation, narrow-scope
denial, bad-token rejection and cleanup. It is distinct from validation against an installed Server
or a production identity provider.
