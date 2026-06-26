---
sidebar_position: 4
---

# OAuth

## Tableau Cloud

### Hosted Tableau MCP

https://mcp.tableau.com is Tableau's hosted version of Tableau MCP. Tableau Cloud users can connect
their agents to this URL without any additional configuration.

All Tableau auth modes are *site scoped*. If you are a multi-site user, and you have connected an MCP client to the hosted Tableau MCP server, you must disconnect, then reconnect to your target site.

**Known Issues**
 - "I'm a multi-site user and I'm connecting to Tableau MCP for the first time, but the OAuth flow is sending me to the wrong site." If a user has an active SiteSAML session in the browser, the Tableau MCP OAuth flow will default to the site the user is logged into. To fix this, sign-out, sign into the target site, then trigger the Tableau MCP OAuth flow again.
 - "I've already connected my MCP Client to the hosted Tableau MCP server. When I disconnect, then reconnect, the OAuth flow never triggers." Once a user has consented to the app for a given site (stored per user + site + client), the OAuth flow silently issues a new access token for that same site on reconnect — no consent screen, no opportunity to select a different site. To force the OAuth flow to re-run, sign out of Tableau in your browser before reconnecting. This clears the SiteSAML session so the OAuth flow has no existing session to resume against, and the full authentication and consent flow will trigger again. Note: a future improvement will add a logout/re-authenticate link directly on the consent screen to make this easier.

*Brian alternate way to show the same info:*

**Issue 1: First-time connection lands on the wrong site**

- **Problem:** When a multi-site user connects to Tableau MCP for the first time, the OAuth flow may send them to the wrong site.
- **Workaround:** Sign out of Tableau Cloud, sign in to the target site, then trigger the Tableau MCP OAuth flow again.

**Issue 2: Reconnecting does not re-trigger the OAuth flow**

- **Problem:** After a user has already connected to the hosted Tableau MCP server, disconnecting and reconnecting may not trigger the OAuth flow again.
- **Workaround:** Sign out of Tableau Cloud, then trigger the Tableau MCP OAuth flow again.

### Self-hosted Tableau MCP

Tableau Cloud customers can self-host Tableau MCP. A full guide can be found at
[Tableau MCP Deployment Guide for Tableau Cloud Customers](../../../enterprise/tableau-cloud.md).

### Local Tableau MCP

Users running Tableau MCP locally can provide the following environment variables to enable OAuth:

```
# The Tableau Cloud pod URL your site is on e.g. https://prod-uswest-c.online.tableau.com
SERVER=https://[prod-my-pod].online.tableau.com

# Tableau's authorization server used to issue access tokens
OAUTH_ISSUER=https://sso.online.tableau.com

# Configures issued access tokens to contain the necessary Tableau API scopes
ADVERTISE_API_SCOPES=true

# Configures Tableau MCP to use the Tableau authZ server, not its embedded authZ server
# which is reserved for Tableau Server users
OAUTH_EMBEDDED_AUTHZ_SERVER=false
```

## Tableau Server

:::warning

Tableau Server must be version 2025.3 or newer.

:::

See [Enabling OAuth (Tableau Server)](../oauth.md) for full details on configuring OAuth.
