---
sidebar_position: 4
---

# OAuth

:::warning

Tableau Server 2025.3+ only. Tableau Cloud OAuth support is currently limited.
Enabling OAuth support against a Tableau Cloud site currently only works when the MCP server
is accessed using a local development URL e.g. `http://127.0.0.1:3927/tableau-mcp`.

:::

When `AUTH` is `oauth`, the MCP server will use a Tableau session initiated by the Tableau OAuth
flow to authenticate to the Tableau REST APIs.

OAuth is enabled by setting the `OAUTH_ISSUER` environment variable to the origin of your MCP server.

:::info

See [Enabling OAuth](../oauth.md) for full details on configuring OAuth.

:::
