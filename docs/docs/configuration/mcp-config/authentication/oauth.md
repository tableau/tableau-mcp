---
sidebar_position: 4
---

# OAuth

## Tableau Cloud

### Hosted Tableau MCP

https://mcp.tableau.com is Tableau's hosted version of Tableau MCP. Tableau Cloud users can connect
their agents to this URL without any additional configuration.

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
