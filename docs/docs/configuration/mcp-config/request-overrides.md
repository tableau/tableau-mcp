---
sidebar_position: 7
---

# Request Overrides

Tableau MCP supports overriding certain configuration variables on a per-request basis via an HTTP header. This allows MCP clients to adjust server behavior for individual requests without changing the server's environment variables or site settings.

Request overrides are only available when using the [HTTP transport](http-server.md).

## Enabling Request Overrides

Request overriding is disabled by default. To enable it, the Tableau MCP server must specify which variables are allowed to be overridden and their restriction type using the [`ALLOWED_REQUEST_OVERRIDES`](env-vars.md#allowed_request_overrides) environment variable.

```
ALLOWED_REQUEST_OVERRIDES=INCLUDE_DATASOURCE_IDS,MAX_RESULT_LIMIT:unrestricted
```

When `ALLOWED_REQUEST_OVERRIDES` is empty or not set, request overriding is disabled entirely and the `x-tableau-mcp-config` header is ignored.

`ALLOWED_REQUEST_OVERRIDES` can also be configured per-site via [Site Settings](site-settings.md) when [`ALLOW_SITES_TO_CONFIGURE_REQUEST_OVERRIDES`](env-vars.md#allow_sites_to_configure_request_overrides) is set to `true`. See [Site-Level Configuration of Allowed Overrides](#site-level-configuration-of-allowed-overrides) for details.

## Providing Request Overrides

Request overrides are provided via the `x-tableau-mcp-config` HTTP header. The header value is a URL-encoded query string of key-value pairs separated by `&`.

```
x-tableau-mcp-config: INCLUDE_DATASOURCE_IDS=abc-123&MAX_RESULT_LIMIT=50
```

- Each key must be a [request overridable variable](#request-overridable-variables).
- Each key must have a value (the `=` sign is required). An empty value (e.g. `MAX_RESULT_LIMIT=`) is valid and is used to override a variable to its default value.
- Any unrecognized keys or invalid override values will cause the request to fail with an error.

## Restriction Types

Each allowed request override variable has a restriction type that determines how the override value is validated. The restriction type is specified in the [`ALLOWED_REQUEST_OVERRIDES`](env-vars.md#allowed_request_overrides) environment variable. If not specified, the default restriction type is `restricted`.

### `restricted`

When a variable is restricted, request overrides can only narrow or maintain the current configuration. They cannot expand access or remove limits.

### `unrestricted`

When a variable is unrestricted, request overrides can set any valid value, including values that expand beyond the current configuration or clear existing limits.

## Request Overridable Variables

The following variables can be overridden on a per-request basis. Each variable has different behavior depending on whether it is `restricted` or `unrestricted`.

### [`INCLUDE_PROJECT_IDS`](tool-scoping.md#include_project_ids)

Overrides which project IDs constrain tool arguments and results.

| Restriction Type | Behavior |
|---|---|
| `restricted` | Override value must be a **subset** of the current bounds. Cannot clear existing bounds. |
| `unrestricted` | Override value can be any valid set of project IDs, including values not in the current bounds. Can clear existing bounds with an empty value. |

### [`INCLUDE_DATASOURCE_IDS`](tool-scoping.md#include_datasource_ids)

Overrides which data source IDs constrain tool arguments and results.

| Restriction Type | Behavior |
|---|---|
| `restricted` | Override value must be a **subset** of the current bounds. Cannot clear existing bounds. |
| `unrestricted` | Override value can be any valid set of data source IDs, including values not in the current bounds. Can clear existing bounds with an empty value. |

### [`INCLUDE_WORKBOOK_IDS`](tool-scoping.md#include_workbook_ids)

Overrides which workbook IDs constrain tool arguments and results.

| Restriction Type | Behavior |
|---|---|
| `restricted` | Override value must be a **subset** of the current bounds. Cannot clear existing bounds. |
| `unrestricted` | Override value can be any valid set of workbook IDs, including values not in the current bounds. Can clear existing bounds with an empty value. |

### [`INCLUDE_TAGS`](tool-scoping.md#include_tags)

Overrides which tags constrain tool arguments and results.

| Restriction Type | Behavior |
|---|---|
| `restricted` | Override value must be a **subset** of the current bounds. Cannot clear existing bounds. |
| `unrestricted` | Override value can be any valid set of tags, including values not in the current bounds. Can clear existing bounds with an empty value. |

### [`MAX_RESULT_LIMIT`](env-vars.md#max_result_limit)

Overrides the global maximum number of results for tools with a `limit` parameter.

| Restriction Type | Behavior |
|---|---|
| `restricted` | Override value must be **less than or equal to** the current limit. Cannot clear existing limit. |
| `unrestricted` | Override value can be any positive number. Can clear existing limit with an empty value. |

### [`MAX_RESULT_LIMITS`](env-vars.md#max_result_limits)

Overrides per-tool maximum result limits.

| Restriction Type | Behavior |
|---|---|
| `restricted` | For tools that currently have a limit, the override value must be **less than or equal to** the current tool-specific limit. Tools omitted from the override will fall back to the global [`MAX_RESULT_LIMIT`](env-vars.md#max_result_limit), which must be less than or equal to the current tool-specific limit. New tools added in the override must have a limit less than or equal to the global `MAX_RESULT_LIMIT`. |
| `unrestricted` | Override value can set any valid per-tool limits. Can clear all per-tool limits with an empty value. |

### [`DISABLE_QUERY_DATASOURCE_VALIDATION_REQUESTS`](env-vars.md#disable_query_datasource_validation_requests)

Overrides whether query validation requests are disabled.

| Restriction Type | Behavior |
|---|---|
| `restricted` | Can only be overridden to `true`. |
| `unrestricted` | Can be overridden to `true` or `false`. |

### [`DISABLE_METADATA_API_REQUESTS`](env-vars.md#disable_metadata_api_requests)

Overrides whether Metadata API requests are disabled.

| Restriction Type | Behavior |
|---|---|
| `restricted` | Can only be overridden to `true`. |
| `unrestricted` | Can be overridden to `true` or `false`. |

## Override Hierarchy

Request overrides are applied on top of site overrides and environment variables in the following order of precedence (highest to lowest):

1. **Request overrides** (per-request, via `x-tableau-mcp-config` header)
2. **Site overrides** (per-site, via REST API, see [Site Settings](site-settings.md))
3. **Environment variables** (server-wide)

For example, if the environment sets `MAX_RESULT_LIMIT=100`, a site override sets it to `50`, and a request override sets it to `25`, the effective value for that request is `25`.

## Invalid Overrides

Request overrides that are invalid will cause the request to fail with an error. The following are examples of invalid overrides:

- Overriding a variable that is not in `ALLOWED_REQUEST_OVERRIDES`.
- Providing an unrecognized variable name in the header.
- Providing a value that does not parse to a valid type (e.g. non-numeric value for `MAX_RESULT_LIMIT`).
- Violating restriction type constraints (e.g. expanding bounds when restricted).

## Site-Level Configuration of Allowed Overrides

Sites can configure their own set of allowed request overrides when [`ALLOW_SITES_TO_CONFIGURE_REQUEST_OVERRIDES`](env-vars.md#allow_sites_to_configure_request_overrides) is set to `true`. When enabled, the site's `ALLOWED_REQUEST_OVERRIDES` value completely replaces the server's environment variable value for sessions on that site. If the site provides an invalid configuration, it is ignored and the server's environment variable value is used instead.

See [Site Settings](site-settings.md) for more information on configuring site overrides.
