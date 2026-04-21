/**
 * OAuth Scope Definitions and Utilities
 *
 * Defines MCP scopes for Tableau MCP server and provides utilities
 * for scope validation and management.
 */

import { getConfig } from '../../config.js';
import type { ToolName } from '../../tools/toolName.web.js';

/**
 * MCP Scopes supported by the Tableau MCP server
 *
 * These scopes represent permissions that clients can request
 * when authenticating with the MCP server.
 */
export type McpScope =
  | 'tableau:mcp:content:read'
  | 'tableau:mcp:datasource:read'
  | 'tableau:mcp:workbook:read'
  | 'tableau:mcp:view:read'
  | 'tableau:mcp:view:download'
  | 'tableau:mcp:pulse:read'
  | 'tableau:mcp:insight:create';

export type TableauApiScope =
  | 'tableau:content:read'
  | 'tableau:viz_data_service:read'
  | 'tableau:views:download'
  | 'tableau:insight_definitions_metrics:read'
  | 'tableau:insight_metrics:read'
  | 'tableau:metric_subscriptions:read'
  | 'tableau:insights:read'
  | 'tableau:insight_brief:create'
  | 'tableau:mcp_site_settings:read';

/**
 * Default scopes supported by the MCP server
 *
 * This list can be configured via environment variable or config file.
 */
export const DEFAULT_SCOPES_SUPPORTED: ReadonlyArray<McpScope> = [
  'tableau:mcp:content:read',
  'tableau:mcp:datasource:read',
  'tableau:mcp:workbook:read',
  'tableau:mcp:view:read',
  'tableau:mcp:view:download',
  'tableau:mcp:pulse:read',
  'tableau:mcp:insight:create',
];

export const RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES: ReadonlyArray<TableauApiScope> = [
  'tableau:content:read',
  'tableau:mcp_site_settings:read',
];

/**
 * Validates that a scope string is a valid MCP scope
 */
export function isValidScope(scope: string): scope is McpScope {
  return supportedMcpScopes.some((supported) => supported === scope);
}

const toolScopeMap: Record<
  ToolName,
  { mcp: ReadonlyArray<McpScope>; api: ReadonlySet<TableauApiScope> }
> = {
  'list-datasources': {
    mcp: ['tableau:mcp:datasource:read'],
    api: new Set(['tableau:content:read', 'tableau:mcp_site_settings:read']),
  },
  'list-workbooks': {
    mcp: ['tableau:mcp:workbook:read'],
    api: new Set(['tableau:content:read', 'tableau:mcp_site_settings:read']),
  },
  'list-views': {
    mcp: ['tableau:mcp:view:read'],
    api: new Set(['tableau:content:read', 'tableau:mcp_site_settings:read']),
  },
  'list-custom-views': {
    mcp: ['tableau:mcp:view:read'],
    api: new Set(['tableau:content:read', 'tableau:mcp_site_settings:read']),
  },
  'query-datasource': {
    mcp: ['tableau:mcp:datasource:read'],
    api: new Set(['tableau:viz_data_service:read', ...RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES]),
  },
  'get-datasource-metadata': {
    mcp: ['tableau:mcp:datasource:read'],
    api: new Set([
      'tableau:content:read',
      'tableau:viz_data_service:read',
      ...RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES,
    ]),
  },
  'get-workbook': {
    mcp: ['tableau:mcp:workbook:read'],
    api: new Set(['tableau:content:read', ...RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES]),
  },
  'get-view-data': {
    mcp: ['tableau:mcp:view:download'],
    api: new Set(['tableau:views:download', ...RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES]),
  },
  'get-view-image': {
    mcp: ['tableau:mcp:view:download'],
    api: new Set(['tableau:views:download', ...RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES]),
  },
  'get-custom-view-data': {
    mcp: ['tableau:mcp:view:download'],
    api: new Set(['tableau:views:download', ...RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES]),
  },
  'list-all-pulse-metric-definitions': {
    mcp: ['tableau:mcp:pulse:read'],
    api: new Set(['tableau:insight_definitions_metrics:read', 'tableau:mcp_site_settings:read']),
  },
  'list-pulse-metric-definitions-from-definition-ids': {
    mcp: ['tableau:mcp:pulse:read'],
    api: new Set(['tableau:insight_definitions_metrics:read', 'tableau:mcp_site_settings:read']),
  },
  'list-pulse-metrics-from-metric-definition-id': {
    mcp: ['tableau:mcp:pulse:read'],
    api: new Set(['tableau:insight_definitions_metrics:read', 'tableau:mcp_site_settings:read']),
  },
  'list-pulse-metrics-from-metric-ids': {
    mcp: ['tableau:mcp:pulse:read'],
    api: new Set(['tableau:insight_metrics:read', 'tableau:mcp_site_settings:read']),
  },
  'list-pulse-metric-subscriptions': {
    mcp: ['tableau:mcp:pulse:read'],
    // 'tableau:insight_metrics:read' is only required if datasource scoping is enabled.
    // Since we don't have an easy way to determine if datasource scoping is enabled, we include it in all cases.
    api: new Set([
      'tableau:metric_subscriptions:read',
      'tableau:insight_metrics:read',
      'tableau:mcp_site_settings:read',
    ]),
  },
  'generate-pulse-metric-value-insight-bundle': {
    mcp: ['tableau:mcp:insight:create'],
    api: new Set(['tableau:insights:read', 'tableau:mcp_site_settings:read']),
  },
  'generate-pulse-insight-brief': {
    mcp: ['tableau:mcp:insight:create'],
    api: new Set(['tableau:insight_brief:create', 'tableau:mcp_site_settings:read']),
  },
  'search-content': {
    mcp: ['tableau:mcp:content:read'],
    api: new Set(['tableau:content:read', 'tableau:mcp_site_settings:read']),
  },
  // Token lifecycle: no Tableau REST API calls, no content scope required.
  // Any authenticated user may revoke their own token regardless of granted scopes.
  'revoke-access-token': {
    mcp: [],
    api: new Set<TableauApiScope>(),
  },
  // Consent lifecycle: no Tableau REST API calls. Bearer-only (Tableau authZ server).
  // Any authenticated user may reset their own consent regardless of granted scopes.
  'reset-consent': {
    mcp: [],
    api: new Set<TableauApiScope>(),
  },
};

const supportedMcpScopes = Array.from(
  new Set(Object.values(toolScopeMap).flatMap((tool) => tool.mcp)),
);
const supportedApiScopes = Array.from(
  new Set(Object.values(toolScopeMap).flatMap((tool) => Array.from(tool.api))),
);

export function getSupportedMcpScopes(): McpScope[] {
  return supportedMcpScopes;
}

export function getSupportedApiScopes(): TableauApiScope[] {
  return supportedApiScopes;
}

export function getSupportedScopes({ includeApiScopes }: { includeApiScopes: boolean }): string[] {
  return includeApiScopes ? [...supportedMcpScopes, ...supportedApiScopes] : supportedMcpScopes;
}

/**
 * Parses a space-separated scope string into an array of scopes
 *
 * @param scopeString - Space-separated scope string (e.g., "read write")
 * @returns Array of valid scope strings
 */
export function parseScopes(scopeString: string | undefined): string[] {
  if (!scopeString || scopeString.trim() === '') {
    return [];
  }
  const scopes = scopeString
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return [...new Set(scopes)];
}

/**
 * Validates an array of scopes against the supported scopes
 *
 * @param requestedScopes - Array of scope strings to validate
 * @param supportedScopes - Array of supported scope strings
 * @returns Object with valid and invalid scopes
 */
export function validateScopes(
  requestedScopes: string[],
  supportedScopes: string[],
): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const scope of requestedScopes) {
    if (supportedScopes.includes(scope)) {
      valid.push(scope);
    } else {
      invalid.push(scope);
    }
  }

  return { valid, invalid };
}

/**
 * Determines the required scopes for a given MCP endpoint/tool
 *
 * This function maps MCP tools to their required scopes.
 * This is used to provide scope guidance in WWW-Authenticate headers.
 *
 * @param endpoint - The MCP endpoint or tool name
 * @returns Array of required scopes for the endpoint
 */
export function getRequiredScopesForTool(toolName: ToolName): ReadonlyArray<McpScope> {
  const oauthConfig = getConfig().oauth;
  if (!oauthConfig || !oauthConfig.enforceScopes) {
    return [];
  }

  return toolScopeMap[toolName].mcp;
}

export function getRequiredApiScopesForTool(toolName: ToolName): ReadonlyArray<TableauApiScope> {
  return Array.from(toolScopeMap[toolName].api);
}

/**
 * Formats scopes as a space-separated string (RFC 6749 format)
 *
 * @param scopes - Array of scope strings
 * @returns Space-separated scope string
 */
export function formatScopes(scopes: string[]): string {
  return scopes.join(' ');
}
