---
sidebar_position: 4
---

# OAuth

:::warning

Tableau Server 2025.3+ only. Tableau Cloud OAuth support is currently in beta. Full production
support requires ABAC scope enforcement from the Tableau authorization server, which is pending a
platform update (ETA Q2 2026). Basic authentication and API access work today, but token scopes
may not be fully enforced server-side until that update ships.

:::

When `AUTH` is `oauth`, the MCP server will use a Tableau session initiated by the Tableau OAuth
flow to authenticate to the Tableau REST APIs.

OAuth is enabled by setting the `OAUTH_ISSUER` environment variable to the origin of your MCP server.

:::info

See [Enabling OAuth](../oauth.md) for full details on configuring OAuth.

:::
