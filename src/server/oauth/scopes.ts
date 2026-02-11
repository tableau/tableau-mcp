/**
 * OAuth Scope Definitions and Utilities
 *
 * Defines MCP scopes for Tableau MCP server and provides utilities
 * for scope validation and management.
 */

import { getConfig } from '../../config.js';
import { ToolName } from '../../tools/toolName.js';

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
  | 'tableau:insight_brief:create';

/**
 * Default scopes supported by the MCP server
 *
 * This list can be configured via environment variable or config file.
 */
export const DEFAULT_SCOPES_SUPPORTED: McpScope[] = [
  'tableau:mcp:content:read',
  'tableau:mcp:datasource:read',
  'tableau:mcp:workbook:read',
  'tableau:mcp:view:read',
  'tableau:mcp:view:download',
  'tableau:mcp:pulse:read',
  'tableau:mcp:insight:create',
];

/**
 * Minimal default scopes suggested when no specific tool is known.
 */
export const DEFAULT_REQUIRED_SCOPES: McpScope[] = ['tableau:mcp:content:read'];

/**
 * Validates that a scope string is a valid MCP scope
 */
export function isValidScope(scope: string): scope is McpScope {
  return supportedMcpScopes.some((supported) => supported === scope);
}

const toolScopeMap: Record<ToolName, { mcp: McpScope[]; api: TableauApiScope[] }> = {
  'list-datasources': {
    mcp: ['tableau:mcp:datasource:read'],
    api: ['tableau:content:read'],
  },
  'list-workbooks': {
    mcp: ['tableau:mcp:workbook:read'],
    api: ['tableau:content:read'],
  },
  'list-views': {
    mcp: ['tableau:mcp:view:read'],
    api: ['tableau:content:read'],
  },
  'query-datasource': {
    mcp: ['tableau:mcp:datasource:read'],
    api: ['tableau:viz_data_service:read'],
  },
  'get-datasource-metadata': {
    mcp: ['tableau:mcp:datasource:read'],
    api: ['tableau:content:read', 'tableau:viz_data_service:read'],
  },
  'get-workbook': {
    mcp: ['tableau:mcp:workbook:read'],
    api: ['tableau:content:read'],
  },
  'get-view-data': {
    mcp: ['tableau:mcp:view:download'],
    api: ['tableau:views:download'],
  },
  'get-view-image': {
    mcp: ['tableau:mcp:view:download'],
    api: ['tableau:views:download'],
  },
  'list-all-pulse-metric-definitions': {
    mcp: ['tableau:mcp:pulse:read'],
    api: ['tableau:insight_definitions_metrics:read'],
  },
  'list-pulse-metric-definitions-from-definition-ids': {
    mcp: ['tableau:mcp:pulse:read'],
    api: ['tableau:insight_definitions_metrics:read'],
  },
  'list-pulse-metrics-from-metric-definition-id': {
    mcp: ['tableau:mcp:pulse:read'],
    api: ['tableau:insight_definitions_metrics:read'],
  },
  'list-pulse-metrics-from-metric-ids': {
    mcp: ['tableau:mcp:pulse:read'],
    api: ['tableau:insight_metrics:read'],
  },
  'list-pulse-metric-subscriptions': {
    mcp: ['tableau:mcp:pulse:read'],
    api: ['tableau:metric_subscriptions:read'],
  },
  'generate-pulse-metric-value-insight-bundle': {
    mcp: ['tableau:mcp:insight:create'],
    api: ['tableau:insights:read'],
  },
  'generate-pulse-insight-brief': {
    mcp: ['tableau:mcp:insight:create'],
    api: ['tableau:insight_brief:create'],
  },
  'search-content': {
    mcp: ['tableau:mcp:content:read'],
    api: ['tableau:content:read'],
  },
};

const supportedMcpScopes = Array.from(
  new Set(Object.values(toolScopeMap).flatMap((tool) => tool.mcp)),
);
const supportedApiScopes = Array.from(
  new Set(Object.values(toolScopeMap).flatMap((tool) => tool.api)),
);

export function getSupportedMcpScopes(): McpScope[] {
  return supportedMcpScopes;
}

export function getSupportedApiScopes(): TableauApiScope[] {
  return supportedApiScopes;
}

export function getSupportedScopes({
  includeApiScopes,
}: {
  includeApiScopes: boolean;
}): string[] {
  return includeApiScopes
    ? [...supportedMcpScopes, ...supportedApiScopes]
    : supportedMcpScopes;
}

export function isTableauApiScope(scope: string): scope is TableauApiScope {
  return supportedApiScopes.some((supported) => supported === scope);
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
export function getRequiredScopesForTool(toolName: ToolName): McpScope[] {
  const oauthConfig = getConfig().oauth;
  if (!oauthConfig || !oauthConfig.enforceScopes) {
    return [];
  }

  return toolScopeMap[toolName].mcp;
}

export function getRequiredApiScopesForTool(toolName: ToolName): TableauApiScope[] {
  return toolScopeMap[toolName].api;
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
