---
sidebar_position: 4
---

# OAuth

:::warning

Tableau Server 2025.3+ only. Full Tableau Cloud is not supported yet but is coming soon ETA Q2 2026.
Until then, enabling OAuth support against a Tableau Cloud site will only work when the MCP server
is accessed using a local development URL e.g. `http://127.0.0.1:3927/tableau-mcp`.

:::

When `AUTH` is `oauth`, the MCP server will use a Tableau session initiated by the Tableau OAuth
flow to authenticate to the Tableau REST APIs.

OAuth is enabled by setting the `OAUTH_ISSUER` environment variable to the URL of your MCP server.

:::info

See [Enabling OAuth](../oauth.md) for full details on configuring OAuth.

:::
