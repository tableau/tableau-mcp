# Authentication

Tableau MCP requires authentication in order to connect with your Tableau Server or Tableau Cloud
site.

This authenticated user must have access to the published data source(s) you plan to access.

Here are the ways you can authenticate to Tableau.

- [PAT](pat.md): Authenticate with a Tableau Personal Access Token.
- [Direct Trust](direct-trust.md): Authenticate with a Tableau Connected App (direct trust) JWT.
- [Unified Access Tokens](uat.md): Authenticate with a Tableau Unified Access Token (Cloud only).
- [OAuth](oauth.md): Sign in through Tableau OAuth, for hosted Cloud and for self-hosted Cloud or Server.
- [Passthrough Authentication](passthrough.md): Reuse an `X-Tableau-Auth` header the way Tableau REST APIs do.

## Troubleshooting authentication errors

An `Authentication failed (401): ...` message returned at tool call means the server could **not
authenticate**: the PAT/OAuth session is missing, invalid, or expired. This is distinct from a permission error
(`Permission denied (403): ...`, authenticated but the request was refused — missing role/permission
or a capability not enabled) and from a feature genuinely not
being provisioned. When several servers are configured, a `401` frequently means the request
reached the **wrong or unauthenticated** server. See
[Running Multiple Servers & Diagnosing Auth Errors](../multiple-servers.md).
