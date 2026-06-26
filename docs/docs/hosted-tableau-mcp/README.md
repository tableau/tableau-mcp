---
sidebar_position: 0
---

# Hosted Tableau MCP

Tableau MCP is available as a managed service on every Tableau Cloud pod, accessible at a single URL: **`https://mcp.tableau.com`**. It is the fastest way to get an AI agent talking to your Tableau Cloud site — no servers to deploy, no credentials to manage, and no infrastructure to maintain.

## Who it's for

The hosted service is intended for **Tableau Cloud customers** who want to connect AI agents (Claude, ChatGPT, Cursor, Slack, custom agents, etc.) to their Tableau site without standing up infrastructure. Tableau Server customers and Cloud customers who require self-hosted infrastructure should see [Enterprise Deployment](../enterprise/).

## What you get

- **OAuth 2.1 authentication out of the box.** Every user signs in to their own Tableau Cloud identity. The MCP server then makes Tableau REST API calls *as that user*, so every existing per-user permission and access control is enforced automatically.
- **Pod-aware routing.** A single URL (`https://mcp.tableau.com`) works for every Tableau Cloud pod. A CloudFront edge function inspects the OAuth token and routes the request to the correct pod. See [Architecture](architecture.md) for details.
- **The full Tableau MCP tool catalog.** All tools documented in the [Tools](../tools/) section are available, subject to your site's SKU entitlements and the signed-in user's permissions.
- **Continuously updated.** New tools and fixes ship to the hosted service automatically — no client-side upgrade required.

## Availability and scope

- Available to **Tableau Cloud customers on any SKU**.
- Not available for Tableau Server. Server customers should [self-host](../enterprise/tableau-server.md).
- Some tools require additional entitlements (e.g. Pulse Insight Briefs require Tableau+; the full Metadata API surface requires Data Management). Tools that require entitlements the signed-in user lacks will return an error at call time.

## Connect a client

See [Popular Client Integrations](./client-integrations.md) for step-by-step instructions for Slack, Claude, ChatGPT, and other common AI clients. In general, point any MCP-compatible client at `https://mcp.tableau.com` and complete the OAuth sign-in flow when prompted.

## Admin controls

- **Disable per site.** Tableau Cloud site administrators can disable MCP access for their site through site settings.
- **Per-user access.** Hosted MCP respects each user's existing site role and permissions; no separate provisioning is required.
- **Audit.** OAuth sign-ins and tool calls are logged via Tableau's standard activity and audit pipelines.

## Data handling

The hosted service does not store your Tableau data. Each tool call is proxied to the same Tableau REST, VDS, Metadata, and Pulse APIs your Tableau Cloud site already exposes, using the signed-in user's access token. See the [Privacy Policy](../privacy.md) for the umbrella data-handling policy.
