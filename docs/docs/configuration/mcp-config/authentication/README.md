# Authentication

Tableau MCP requires authentication in order to connect with your Tableau Server or Tableau Cloud
site.

This authenticated user must have access to the published data source(s) you plan to access.

There are a couple different ways to authenticate to Tableau.

1. Provide your Tableau [Personal Access Token](pat.md) (PAT).
2. Use Tableau [Connected Apps](direct-trust.md).
3. Use Tableau [Unified Access Tokens](uat.md).
4. Use Tableau [OAuth](oauth.md).
5. Use [Passthrough Authentication](passthrough.md).

## Troubleshooting authentication errors

An `Authentication failed (401): ...` message — whether returned at tool call or logged at startup
while fetching site settings — means the server could **not authenticate**: the PAT/OAuth session
is missing, invalid, or expired. This is distinct from a permission error
(`Permission denied (403): ...`, authenticated but the request was refused — missing role/permission
or a capability not enabled) and from a feature genuinely not
being provisioned. When several servers are configured, a `401` frequently means the request
reached the **wrong or unauthenticated** server. See
[Running Multiple Servers & Diagnosing Auth Errors](../multiple-servers.md).
