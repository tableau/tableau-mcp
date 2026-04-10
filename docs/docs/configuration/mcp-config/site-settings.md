---
sidebar_position: 6
---

# Site Settings

Tableau MCP supports configuration on a per-site basis via [REST API](coming_soon). When a Tableau MCP user is authenticated to a given site, the site's configuration is fetched and applied to their session such that each setting will override any current value set by the Tableau MCP server.

In order to use site settings:
- Only available in Tableau versions 2026.2 or higher.
- Site settings must be enabled by the Tableau MCP server, see [`ENABLE_MCP_SITE_SETTINGS`](env-vars.md#enable_mcp_site_settings) and [`MCP_SITE_SETTINGS_CHECK_INTERVAL_IN_MINUTES`](env-vars.md#mcp_site_settings_check_interval_in_minutes).

## Configuring Site Settings

Only site and server administrators are able to configure Tableau MCP site settings.
Not every Tableau MCP configuration variable is overridable with site settings, only the ones listed as [Site Overridable Variables](#site-overridable-variables).

When creating or updating site settings via [REST API](coming_soon):
- To use a variable's default value or clear limits and bounds set by the Tableau MCP server, you can provide an empty string as the override value.
- To remove an override variable from the list of site settings and restore its value back to what is set by the Tableau MCP server,
  you can `POST` the current list of site settings minus the variable you want to remove or include the variable in a `PUT` request with a null value or omit the value property entirely.

## Site Overridable Variables

- ### [`DISABLE_METADATA_API_REQUESTS`](env-vars.md#disable_metadata_api_requests)
- ### [`DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS`](env-vars.md#disable_query_datasource_validation_requests)
- ### [`EXCLUDE_TOOLS`](env-vars.md#exclude_tools)
- ### [`INCLUDE_DATASOURCE_IDS`](tool-scoping.md#include_datasource_ids)
- ### [`INCLUDE_PROJECT_IDS`](tool-scoping.md#include_project_ids)
- ### [`INCLUDE_TOOLS`](env-vars.md#include_tools)
- ### [`INCLUDE_TAGS`](tool-scoping.md#include_tags)
- ### [`INCLUDE_WORKBOOK_IDS`](tool-scoping.md#include_workbook_ids)
- ### [`MAX_RESULT_LIMIT`](env-vars.md#max_result_limit)
- ### [`MAX_RESULT_LIMITS`](env-vars.md#max_result_limits)
