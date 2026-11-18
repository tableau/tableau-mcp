---
sidebar_position: 8
---

# MCP Configuration for Site Administrators
This page is a guide for Tableau **site and server administrators** who are responsible for
securing and governing a Tableau MCP deployment, and for customizing MCP guardrails for your organization. It brings together the configuration surfaces most
relevant to administrators and explains how they layer together.

The guidance here applies to **both** ways of running Tableau MCP:

- **[Hosted Tableau MCP](../../hosted-tableau-mcp/README.md)** — the managed service that runs on
  every Tableau Cloud pod at `https://mcp.tableau.com`. Tableau operates the server, so you do not
  set environment variables. Your governance lever is **[Site Settings](site-settings.md)**,
  applied per-site via the REST API.
- **Self-hosted** — a server you deploy and operate yourself (for example, a
  [fork of the repo](../../getting-started#build-from-source) or a
  [self-hosted enterprise deployment](../../enterprise/README.md)). You own **environment
  variables** as your baseline, and can additionally delegate configuration through Site Settings
  and [Request Overrides](request-overrides.md).

If you are looking for the full catalog of every setting, see
[Environment Variables](env-vars.md). This page focuses on the subset that administrators
typically own.

:::info

The quickest way to tell which surfaces apply to you: if you connect clients to
`https://mcp.tableau.com`, you are on the **hosted** service and configure it through
[Site Settings](site-settings.md). If you run the server yourself at a URL you own, you are
**self-hosted** and configure it primarily through **environment variables**. See
[How configuration layers together](#how-configuration-layers-together) for the order of
precedence.

:::

## How configuration layers together

Tableau MCP resolves configuration from several sources. When the same variable is set in more than
one place, the higher-precedence source wins (highest to lowest):

1. **Request overrides** — per-request, via the `x-tableau-mcp-config` HTTP header (only for the
   [HTTP transport](http-server.md), self-hosted deployments). See
   [Request Overrides](request-overrides.md).
2. **Site settings** — per-site, applied to every user authenticated to that site. See
   [Site Settings](site-settings.md).
3. **Environment variables** — server-wide defaults set by the administrator who runs the server
   (self-hosted only).

**Self-hosted:** environment variables are your baseline. Site settings and request overrides only
apply to variables you have explicitly marked as overridable, so you remain in control of what can
be changed downstream.

**Hosted Tableau MCP:** Tableau owns the environment variables and the runtime, so you cannot set or
see them. **Site Settings are the surface you control** — they let you govern the hosted service for
each of your sites without deploying anything. The rest of this page calls out, per topic, whether a
control is available on the hosted service or only when self-hosting.

## Environment parameters (self-hosted)

:::note

This section applies only to **self-hosted** deployments. On the
[hosted service](../../hosted-tableau-mcp/README.md), Tableau sets these values for you; skip ahead
to [Governing the hosted service with Site Settings](#governing-the-hosted-service-with-site-settings).

:::


Environment variables (often supplied via a `.env` file, container environment, or your process
manager) are the primary way administrators configure a deployment. The variables below are the ones
administrators most commonly need to set. For everything else, see
[Environment Variables](env-vars.md).

### Server connection

| Variable | Purpose |
|---|---|
| [`SERVER`](env-vars.md#server) | URL of the Tableau Cloud pod or Tableau Server. |
| [`SITE_NAME`](env-vars.md#site_name) | Content URL of the site to connect to. |
| [`TRANSPORT`](env-vars.md#transport) | `stdio` for single-user, or `http` for multi-user deployments. |
| [`AUTH`](env-vars.md#auth) | Authentication method (`pat`, `direct-trust`, or `oauth`). |

:::tip

For any shared, multi-user deployment, run the server with `TRANSPORT=http` and protect it with
[OAuth](./authentication/oauth.md). Non-OAuth HTTP configurations are intended only for
testing/prototyping or deployments licensed and approved for usage-based licensing (UBL). See the
[HTTP Server](http-server.md) page for details.

:::

### Admin-only tools

Several tools are restricted to Tableau site administrators. They are disabled by default and must
be turned on explicitly.

- [`ADMIN_TOOLS_ENABLED`](env-vars.md#admin_tools_enabled) — enables administrator-only tools such
  as [`list-users`](../../web-tools/users/list-users.md),
  [`list-jobs`](../../web-tools/jobs/list-jobs.md),
  [`delete-content`](../../web-tools/content/delete-content.md), and
  [`query-admin-insights`](../../web-tools/admin-insights/query-admin-insights.md). These tools perform
  runtime role verification and return a `403` for callers who are not a
  `SiteAdministratorCreator`, `SiteAdministratorExplorer`, or `ServerAdministrator`.
- [`ADMIN_GATE_CACHE_TTL_MINUTES`](env-vars.md#admin_gate_cache_ttl_minutes) — how long admin role
  lookups and related metadata are cached. Lower it if role changes need to propagate faster.
- [`MUTATION_PREVIEW_TTL_MINUTES`](env-vars.md#mutation_preview_ttl_minutes) — lifetime of the
  single-use confirmation tokens used by two-phase mutation tools (e.g.
  [`delete-content`](../../web-tools/content/delete-content.md)).

:::warning

Admin tools can read sensitive site data and, in some cases, delete content or change user site
roles. Enable them only for deployments where the authenticated caller's site role can be trusted,
and prefer OAuth so each caller's identity and permissions are enforced by Tableau.

:::

### Governing what tools and data are exposed

- [`INCLUDE_TOOLS`](env-vars.md#include_tools) / [`EXCLUDE_TOOLS`](env-vars.md#exclude_tools) —
  restrict which tools (or tool groups) are registered. Provide only one of the two.
- [Tool Scoping](tool-scoping.md) variables
  ([`INCLUDE_PROJECT_IDS`](tool-scoping.md#include_project_ids),
  [`INCLUDE_DATASOURCE_IDS`](tool-scoping.md#include_datasource_ids),
  [`INCLUDE_WORKBOOK_IDS`](tool-scoping.md#include_workbook_ids),
  [`INCLUDE_VIEW_IDS`](tool-scoping.md#include_view_ids),
  [`INCLUDE_TAGS`](tool-scoping.md#include_tags)) — constrain tool arguments and results to a
  specific set of content.
- [`MAX_RESULT_LIMIT`](env-vars.md#max_result_limit) /
  [`MAX_RESULT_LIMITS`](env-vars.md#max_result_limits) — cap the number of results tools may return,
  globally or per tool.

:::tip Hosted service

Every variable in this list is also a
[site-overridable variable](site-settings.md#site-overridable-variables), so you can apply the same
governance on the **hosted service** through [Site Settings](site-settings.md) — for example,
excluding tools or scoping content on `https://mcp.tableau.com` per site. See
[Governing the hosted service with Site Settings](#governing-the-hosted-service-with-site-settings).

:::

### Logging, telemetry, and safety

- [`ENABLED_LOGGERS`](env-vars.md#enabled_loggers) and
  [`FILE_LOGGER_DIRECTORY`](env-vars.md#file_logger_directory) — control server logging.
- [`DISABLE_LOG_MASKING`](env-vars.md#disable_log_masking) — leave at the default (`false`) in
  production. Credentials and tokens are masked by default; only disable masking for local
  debugging.
- [`PRODUCT_TELEMETRY_ENABLED`](env-vars.md#product_telemetry_enabled) — controls product usage
  telemetry.
- [`BREAK_GLASS_DISABLE_GLOBALLY`](env-vars.md#break_glass_disable_globally) — an emergency kill
  switch that makes every tool return a "service unavailable" error. Use with discretion.

:::danger

Never commit real secrets (PAT values, OAuth client secrets, connected-app keys) to source
control, and do not disable log masking in a committed configuration.

:::

## Governing the hosted service with Site Settings

Site Settings are the primary governance surface for the **hosted service** and an optional
delegation surface for **self-hosted** deployments. They let you tailor a curated subset of
configuration per site, applied to every user authenticated to that site, without deploying or
restarting anything. See [Site Settings](site-settings.md).

- Site settings are enabled by default via
  [`ENABLE_MCP_SITE_SETTINGS`](site-settings.md#enable_mcp_site_settings) (Tableau version 2026.2 or
  higher).
- Only [site-overridable variables](site-settings.md#site-overridable-variables) can be changed this
  way — for example [`EXCLUDE_TOOLS`](env-vars.md#exclude_tools),
  [`MAX_RESULT_LIMIT`](env-vars.md#max_result_limit), and the tool-scoping `INCLUDE_*` variables.
- Only site and server administrators can create or update site settings, via the
  [Tableau MCP REST API](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_tableau_mcp.htm).
- Changes may not take effect immediately because of caching — see
  [`MCP_SITE_SETTINGS_CHECK_INTERVAL_IN_MINUTES`](site-settings.md#mcp_site_settings_check_interval_in_minutes).

:::info Hosted service

On `https://mcp.tableau.com` you cannot disable the service, but you can restrict what it does on
your site. For example, exclude every tool group via `EXCLUDE_TOOLS` in Site Settings — see
[Admin controls](../../hosted-tableau-mcp/README.md#admin-controls) for the exact REST API payload.

:::

## Allowing per-request overrides (self-hosted)

For self-hosted HTTP deployments, you can additionally let clients adjust a curated set of variables
on a per-request basis via the `x-tableau-mcp-config` header. This is **disabled by default** and is
not available on the hosted service. See [Request Overrides](request-overrides.md).

- Enable it by listing the allowed variables and their
  [restriction type](request-overrides.md#restriction-types) in
  [`ALLOWED_REQUEST_OVERRIDES`](request-overrides.md#allowed_request_overrides).
- Use the `restricted` type (the default) to let requests only narrow — never expand — the current
  configuration.
- To let each site manage its own allow-list, set
  [`ALLOW_SITES_TO_CONFIGURE_REQUEST_OVERRIDES`](request-overrides.md#allow_sites_to_configure_request_overrides)
  to `true`.

## Recommended baseline

### Hosted service

On `https://mcp.tableau.com` you govern the service per site through
[Site Settings](site-settings.md), submitted via the
[Tableau MCP REST API](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_tableau_mcp.htm).
A conservative starting point caps result sizes and, optionally, narrows the exposed tools:

```json title="JSON"
{
  "mcpSiteSettings": {
    "settings": [
      { "key": "MAX_RESULT_LIMIT", "value": "100" },
      { "key": "EXCLUDE_TOOLS", "value": "" }
    ]
  }
}
```

Leave `EXCLUDE_TOOLS` empty to keep the full catalog, or list the tool groups you want to block —
see [Admin controls](../../hosted-tableau-mcp/README.md#admin-controls) for the full-block payload.
Authentication, transport, and logging are managed by Tableau on the hosted service.

### Self-hosted

A typical hardened, multi-user self-hosted configuration looks like:

```bash
SERVER=https://prod-useast-c.online.tableau.com
SITE_NAME=my-site
TRANSPORT=http
AUTH=oauth

# Turn on admin tools only if your callers are trusted site admins
ADMIN_TOOLS_ENABLED=false

# Keep secrets masked in logs
DISABLE_LOG_MASKING=false

# Constrain what can be returned
MAX_RESULT_LIMIT=100

# Request overrides off unless you explicitly need them
ALLOWED_REQUEST_OVERRIDES=
```

Adjust from either baseline as your governance, licensing, and security requirements dictate.

## Related

- [Hosted Tableau MCP](../../hosted-tableau-mcp/README.md) — the managed service on Tableau Cloud.
- [Enterprise Deployment](../../enterprise/README.md) — self-hosting for Tableau Server or Cloud.
- [Environment Variables](env-vars.md) — the full catalog of settings (self-hosted).
- [Authentication](authentication) — choosing and configuring an auth method.
- [HTTP Server](http-server.md) — running the server for multiple clients.
- [Tool Scoping](tool-scoping.md) — limiting tools to specific content.
- [Site Settings](site-settings.md) — per-site overrides (both hosted and self-hosted).
- [Request Overrides](request-overrides.md) — per-request overrides (self-hosted).
