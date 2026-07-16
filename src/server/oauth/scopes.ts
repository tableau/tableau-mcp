/**
 * OAuth Scope Definitions and Utilities
 *
 * Defines MCP scopes for Tableau MCP server and provides utilities
 * for scope validation and management.
 */

import { getConfig } from '../../config.js';
import { getFeatureGate } from '../../features/init.js';
import type { WebToolName } from '../../tools/web/toolName.js';

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
  | 'tableau:mcp:insight:create'
  | 'tableau:mcp:tasks:read'
  | 'tableau:mcp:tasks:delete'
  | 'tableau:mcp:tasks:write'
  | 'tableau:mcp:workbook:delete'
  | 'tableau:mcp:jobs:read'
  | 'tableau:mcp:datasource:delete'
  | 'tableau:mcp:content:delete'
  | 'tableau:mcp:users:read';

export type TableauApiScope =
  | 'tableau:content:read'
  | 'tableau:viz_data_service:read'
  | 'tableau:views:download'
  | 'tableau:views:embed'
  | 'tableau:insight_definitions_metrics:read'
  | 'tableau:insight_metrics:read'
  | 'tableau:metric_subscriptions:read'
  | 'tableau:insights:read'
  | 'tableau:insight_brief:create'
  | 'tableau:mcp_site_settings:read'
  | 'tableau:tasks:read'
  | 'tableau:tasks:delete'
  | 'tableau:tasks:write'
  | 'tableau:workbook_tags:update'
  | 'tableau:workbooks:delete'
  | 'tableau:datasource_tags:update'
  | 'tableau:datasources:delete'
  | 'tableau:jobs:read'
  | 'tableau:users:read';

/**
 * Default scopes supported by the MCP server
 *
 * This list can be configured via environment variable or config file.
 */
export const DEFAULT_SCOPES_SUPPORTED: ReadonlyArray<McpScope> = [
  'tableau:mcp:datasource:read',
  'tableau:mcp:datasource:delete',
  'tableau:mcp:tasks:read',
  'tableau:mcp:tasks:delete',
  'tableau:mcp:tasks:write',
  'tableau:mcp:jobs:read',
  'tableau:mcp:users:read',
  'tableau:mcp:workbook:read',
  'tableau:mcp:workbook:delete',
  'tableau:mcp:content:read',
  'tableau:mcp:content:delete',
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
  return getSupportedMcpScopes().some((supported) => supported === scope);
}

const toolScopeMap: Record<
  WebToolName,
  { mcp: ReadonlyArray<McpScope>; api: ReadonlySet<TableauApiScope> }
> = {
  'list-datasources': {
    mcp: ['tableau:mcp:datasource:read'],
    api: new Set(['tableau:content:read', 'tableau:mcp_site_settings:read']),
  },
  'list-extract-refresh-tasks': {
    mcp: ['tableau:mcp:tasks:read'],
    api: new Set(['tableau:tasks:read', 'tableau:users:read']),
  },
  'delete-extract-refresh-task': {
    mcp: ['tableau:mcp:tasks:delete'],
    api: new Set(['tableau:tasks:delete', 'tableau:users:read']),
  },
  // Admin-only, app-only confirm step for delete-extract-refresh-task (MCP-Apps HITL). Invoked ONLY
  // by a human gesture in the rendered iframe (visibility:['app']), never the model. Deletes the task
  // (tasks:delete); adminGate.assertAdmin → GET /sites/{siteId}/users/{userId} → users:read.
  'confirm-delete-extract-refresh-task': {
    mcp: ['tableau:mcp:tasks:delete'],
    api: new Set(['tableau:tasks:delete', 'tableau:users:read']),
  },
  'update-cloud-extract-refresh-task': {
    mcp: ['tableau:mcp:tasks:write'],
    api: new Set(['tableau:tasks:write', 'tableau:users:read']),
  },
  // Admin-only, app-only confirm step for update-cloud-extract-refresh-task (MCP-Apps HITL). Invoked
  // ONLY by a human gesture in the rendered iframe (visibility:['app']), never the model. Applies the
  // schedule change (tasks:write); adminGate.assertAdmin → GET /sites/{siteId}/users/{userId} →
  // users:read.
  'confirm-update-cloud-extract-refresh-task': {
    mcp: ['tableau:mcp:tasks:write'],
    api: new Set(['tableau:tasks:write', 'tableau:users:read']),
  },
  'list-jobs': {
    mcp: ['tableau:mcp:jobs:read'],
    api: new Set(['tableau:jobs:read', 'tableau:users:read']),
  },
  'list-users': {
    mcp: ['tableau:mcp:users:read'],
    api: new Set(['tableau:users:read']),
  },
  'list-workbooks': {
    mcp: ['tableau:mcp:workbook:read'],
    api: new Set(['tableau:content:read', 'tableau:mcp_site_settings:read']),
  },
  // Admin-only destructive tool. Two-phase: preview tags the workbook (workbook_tags:update) and
  // resolves the owner (users:read); confirm deletes it (workbooks:delete). getWorkbook → content:read.
  // adminGate.assertAdmin → GET /sites/{siteId}/users/{userId} → users:read. Goes through the
  // resourceAccessChecker (tool scoping), so it also needs RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES
  // (content:read + mcp_site_settings:read).
  'delete-workbook': {
    mcp: ['tableau:mcp:workbook:delete'],
    api: new Set([
      'tableau:workbooks:delete',
      'tableau:workbook_tags:update',
      'tableau:users:read',
      ...RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES,
    ]),
  },
  // Admin-only, app-only confirm step for delete-workbook (MCP-Apps HITL). Invoked ONLY by a human
  // gesture in the rendered iframe (visibility:['app']), never the model. Re-fetches + re-checks the
  // pending-deletion tag and deletes (workbooks:delete + content:read), resolves the owner for the
  // audit (users:read), and goes through the resourceAccessChecker — same API scopes as delete-workbook
  // minus the tag write (the tag was applied in the preview phase).
  'confirm-delete-workbook': {
    mcp: ['tableau:mcp:workbook:delete'],
    api: new Set([
      'tableau:workbooks:delete',
      'tableau:users:read',
      ...RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES,
    ]),
  },
  // Admin-only destructive tool. Preview tags the datasource (datasource_tags:update), resolves the
  // owner (users:read), and warns about dependent workbooks/flows via the Metadata API (content:read);
  // confirm deletes it (datasources:delete). adminGate.assertAdmin → GET /users/{id} → users:read.
  // Goes through the resourceAccessChecker (tool scoping), so it also needs
  // RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES (content:read + mcp_site_settings:read).
  'delete-datasource': {
    mcp: ['tableau:mcp:datasource:delete'],
    api: new Set([
      'tableau:datasources:delete',
      'tableau:datasource_tags:update',
      'tableau:users:read',
      ...RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES,
    ]),
  },
  // Admin-only, app-only confirm step for delete-datasource (MCP-Apps HITL). Invoked ONLY by a human
  // gesture in the rendered iframe (visibility:['app']), never the model. Re-fetches + re-checks the
  // pending-deletion tag and deletes (datasources:delete + content:read), resolves the owner for the
  // audit (users:read), and goes through the resourceAccessChecker — same API scopes as
  // delete-datasource minus the tag write (the tag was applied in the preview phase).
  'confirm-delete-datasource': {
    mcp: ['tableau:mcp:datasource:delete'],
    api: new Set([
      'tableau:datasources:delete',
      'tableau:users:read',
      ...RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES,
    ]),
  },
  'list-projects': {
    mcp: ['tableau:mcp:content:read'],
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
  'get-embed-token': {
    mcp: [],
    api: new Set<TableauApiScope>(['tableau:views:embed']),
  },
  'get-workbook': {
    mcp: ['tableau:mcp:workbook:read'],
    api: new Set(['tableau:content:read', ...RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES]),
  },
  'get-view': {
    mcp: ['tableau:mcp:view:read'],
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
  'get-custom-view-image': {
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
  // MCP-app error telemetry relay: no Tableau REST API calls, no content scope required.
  'record-mcp-app-error': {
    mcp: [],
    api: new Set<TableauApiScope>(),
  },
  // Admin Insights (admin-only). Resolves dataset LUID via list-datasources, then VDS query.
  // Bypasses resourceAccessChecker — datasources are internal/known and admin-gated.
  'query-admin-insights-ts-events': {
    mcp: ['tableau:mcp:datasource:read'],
    api: new Set([
      'tableau:viz_data_service:read',
      'tableau:content:read',
      'tableau:mcp_site_settings:read',
      // adminGate.assertAdmin → GET /sites/{siteId}/users/{userId}
      'tableau:users:read',
    ]),
  },
  'query-admin-insights-site-content': {
    mcp: ['tableau:mcp:datasource:read'],
    api: new Set([
      'tableau:viz_data_service:read',
      'tableau:content:read',
      'tableau:mcp_site_settings:read',
      'tableau:users:read',
    ]),
  },
  'query-admin-insights-job-performance': {
    mcp: ['tableau:mcp:datasource:read'],
    api: new Set([
      'tableau:viz_data_service:read',
      'tableau:content:read',
      'tableau:mcp_site_settings:read',
      'tableau:users:read',
    ]),
  },
  // Server-side anti-join: runs TS Events + Site Content VDS queries internally,
  // applies threshold, returns final filtered rows. Deterministic — no LLM math.
  'get-stale-content-report': {
    mcp: ['tableau:mcp:datasource:read'],
    api: new Set([
      'tableau:viz_data_service:read',
      'tableau:content:read',
      'tableau:mcp_site_settings:read',
      'tableau:users:read',
    ]),
  },
  // Consolidated admin-insights tool (W-23375797). Dispatches on `kind` to ts-events, site-content,
  // job-performance (raw VDS) or stale-content (server-side anti-join). Union of the scopes required
  // by the four legacy tools it replaces — any kind may need any of these.
  'query-admin-insights': {
    mcp: ['tableau:mcp:datasource:read'],
    api: new Set([
      'tableau:viz_data_service:read',
      'tableau:content:read',
      'tableau:mcp_site_settings:read',
      'tableau:users:read',
    ]),
  },
  // Consolidated destructive-delete tool (W-23375797). Dispatches on `resourceType` to workbook,
  // datasource, or extract-refresh-task. Gated on a single umbrella MCP scope
  // (`tableau:mcp:content:delete`) that covers all three dispatch paths — declaring the three
  // per-resource legacy scopes here would be AND-enforced by authMiddleware and lock out callers
  // who only granted one of them. Callers who need per-resource granularity keep using the legacy
  // `delete-{workbook,datasource,extract-refresh-task}` tools during the shim window. Workbook and
  // datasource paths still route through resourceAccessChecker (union of API scopes preserved).
  'delete-content': {
    mcp: ['tableau:mcp:content:delete'],
    api: new Set([
      'tableau:workbooks:delete',
      'tableau:workbook_tags:update',
      'tableau:datasources:delete',
      'tableau:datasource_tags:update',
      'tableau:tasks:delete',
      'tableau:users:read',
      ...RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES,
    ]),
  },
};

function getEnabledToolNames(): Set<WebToolName> {
  const config = getConfig();
  const featureGate = getFeatureGate();
  const enabledTools = new Set<WebToolName>(Object.keys(toolScopeMap) as WebToolName[]);

  // Remove disabled tools based on feature flags
  if (!config.adminToolsEnabled) {
    enabledTools.delete('list-extract-refresh-tasks');
    enabledTools.delete('delete-extract-refresh-task');
    enabledTools.delete('confirm-delete-extract-refresh-task');
    enabledTools.delete('update-cloud-extract-refresh-task');
    enabledTools.delete('confirm-update-cloud-extract-refresh-task');
    enabledTools.delete('delete-workbook');
    enabledTools.delete('confirm-delete-workbook');
    enabledTools.delete('list-jobs');
    enabledTools.delete('delete-datasource');
    enabledTools.delete('confirm-delete-datasource');
    enabledTools.delete('list-users');
    enabledTools.delete('query-admin-insights-ts-events');
    enabledTools.delete('query-admin-insights-site-content');
    enabledTools.delete('query-admin-insights-job-performance');
    enabledTools.delete('get-stale-content-report');
    enabledTools.delete('query-admin-insights');
    enabledTools.delete('delete-content');
  }

  // Remove the MCP-Apps-only tools if the mcp-apps feature is disabled. The confirm-* tools are the
  // human-gesture confirm steps for their preview tools and only exist when the iframe can render.
  if (!featureGate.isFeatureEnabled('mcp-apps')) {
    enabledTools.delete('get-embed-token');
    enabledTools.delete('record-mcp-app-error');
    enabledTools.delete('confirm-delete-workbook');
    enabledTools.delete('confirm-delete-datasource');
    enabledTools.delete('confirm-delete-extract-refresh-task');
    enabledTools.delete('confirm-update-cloud-extract-refresh-task');
  }

  return enabledTools;
}

export function getSupportedMcpScopes(): McpScope[] {
  const enabledTools = getEnabledToolNames();
  const scopes = new Set<McpScope>();

  for (const [toolName, scopeConfig] of Object.entries(toolScopeMap)) {
    if (enabledTools.has(toolName as WebToolName)) {
      for (const scope of scopeConfig.mcp) {
        scopes.add(scope);
      }
    }
  }

  return Array.from(scopes);
}

export function getSupportedApiScopes(): TableauApiScope[] {
  const enabledTools = getEnabledToolNames();
  const scopes = new Set<TableauApiScope>();

  for (const [toolName, scopeConfig] of Object.entries(toolScopeMap)) {
    if (enabledTools.has(toolName as WebToolName)) {
      for (const scope of scopeConfig.api) {
        scopes.add(scope);
      }
    }
  }

  return Array.from(scopes);
}

export function getSupportedScopes({ includeApiScopes }: { includeApiScopes: boolean }): string[] {
  const mcpScopes = getSupportedMcpScopes();
  const apiScopes = getSupportedApiScopes();
  return includeApiScopes ? [...mcpScopes, ...apiScopes] : mcpScopes;
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
export function getRequiredScopesForTool(toolName: WebToolName): ReadonlyArray<McpScope> {
  const oauthConfig = getConfig().oauth;
  if (!oauthConfig || !oauthConfig.enforceScopes) {
    return [];
  }

  return toolScopeMap[toolName].mcp;
}

export function getRequiredApiScopesForTool(toolName: WebToolName): ReadonlyArray<TableauApiScope> {
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
