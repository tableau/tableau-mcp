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
  | 'tableau:mcp:flow:read'
  | 'tableau:mcp:pulse:read'
  | 'tableau:mcp:insight:create'
  | 'tableau:mcp:tasks:read'
  | 'tableau:mcp:tasks:write'
  | 'tableau:mcp:jobs:read'
  | 'tableau:mcp:content:delete'
  | 'tableau:mcp:users:read'
  | 'tableau:mcp:users:write';

export type TableauApiScope =
  | 'tableau:content:read'
  | 'tableau:viz_data_service:read'
  | 'tableau:views:download'
  | 'tableau:views:embed'
  | 'tableau:flows:read'
  | 'tableau:flow_connections:read'
  | 'tableau:flow_runs:read'
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
  | 'tableau:users:read'
  | 'tableau:users:update';

/**
 * Default scopes supported by the MCP server
 *
 * This list can be configured via environment variable or config file.
 */
export const DEFAULT_SCOPES_SUPPORTED: ReadonlyArray<McpScope> = [
  'tableau:mcp:datasource:read',
  'tableau:mcp:tasks:read',
  'tableau:mcp:tasks:write',
  'tableau:mcp:jobs:read',
  'tableau:mcp:users:read',
  'tableau:mcp:workbook:read',
  'tableau:mcp:content:read',
  'tableau:mcp:content:delete',
  'tableau:mcp:users:write',
  'tableau:mcp:view:read',
  'tableau:mcp:view:download',
  'tableau:mcp:flow:read',
  'tableau:mcp:pulse:read',
  'tableau:mcp:insight:create',
];

export const RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES: ReadonlyArray<TableauApiScope> = [
  'tableau:content:read',
  'tableau:mcp_site_settings:read',
];

/**
 * Scopes the resource access checker needs to fetch a *flow* for a
 * bounded-context check. Flows are gated by `tableau:flows:read` (NOT
 * `tableau:content:read`, which covers workbooks/datasources/views), so this
 * is intentionally kept separate from RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES
 * to avoid forcing the flow scope onto every other resource check (which would
 * break those checks for connected apps that do not grant `tableau:flows:read`).
 */
export const RESOURCE_ACCESS_CHECKER_FLOW_API_SCOPES: ReadonlyArray<TableauApiScope> = [
  'tableau:flows:read',
  'tableau:mcp_site_settings:read',
];

/**
 * Tableau API scopes for the `get-flow` tool, defined here so the tool composes
 * its per-call scope set from named constants instead of scattering scope
 * string literals across the codebase.
 *
 * `get-flow` requests the *minimum* scopes needed for each call rather than the
 * full superset: Tableau Connected Apps reject a JWT mint that asks for an
 * un-granted scope, so a metadata-only deployment (a connected app granting
 * only `tableau:flows:read`) must be able to call `get-flow` without the
 * sidecar scopes. `GET_FLOW_BASE_API_SCOPES` is always required; the
 * connections / runs scopes are added only when the caller opts into that
 * sidecar.
 *
 * The maximum set (`toolScopeMap['get-flow'].api`, used for the MCP-layer OAuth
 * gate) is composed from these same constants, so there is a single source of
 * truth for the get-flow scope surface.
 */
export const GET_FLOW_BASE_API_SCOPES: ReadonlyArray<TableauApiScope> = [
  'tableau:flows:read',
  'tableau:mcp_site_settings:read',
];
export const GET_FLOW_CONNECTIONS_API_SCOPE: TableauApiScope = 'tableau:flow_connections:read';
export const GET_FLOW_RUNS_API_SCOPE: TableauApiScope = 'tableau:flow_runs:read';

/**
 * Validates that a scope string is a valid MCP scope
 */
export async function isValidScope(scope: string): Promise<boolean> {
  return (await getSupportedMcpScopes()).some((supported) => supported === scope);
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
  'update-user': {
    mcp: ['tableau:mcp:users:write'],
    api: new Set(['tableau:users:update', 'tableau:users:read']),
  },
  'list-workbooks': {
    mcp: ['tableau:mcp:workbook:read'],
    api: new Set(['tableau:content:read', 'tableau:mcp_site_settings:read']),
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
  'list-flows': {
    mcp: ['tableau:mcp:flow:read'],
    api: new Set(['tableau:flows:read', 'tableau:mcp_site_settings:read']),
  },
  'get-flow': {
    mcp: ['tableau:mcp:flow:read'],
    // Maximum scope surface for the MCP-layer OAuth gate, composed from the same
    // constants get-flow uses to build its per-call minimum set (single source
    // of truth — see GET_FLOW_BASE_API_SCOPES).
    api: new Set([
      ...GET_FLOW_BASE_API_SCOPES,
      GET_FLOW_CONNECTIONS_API_SCOPE,
      GET_FLOW_RUNS_API_SCOPE,
    ]),
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
  'resolve-datasource-luid': {
    mcp: ['tableau:mcp:datasource:read'],
    api: new Set(['tableau:content:read', 'tableau:mcp_site_settings:read']),
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
  'generate-insight-cards': {
    mcp: ['tableau:mcp:insight:create', 'tableau:mcp:datasource:read'],
    api: new Set([
      'tableau:insights:read',
      'tableau:content:read',
      'tableau:viz_data_service:read',
      'tableau:mcp_site_settings:read',
    ]),
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
  // Dispatches on `kind` to ts-events, site-content, job-performance (raw VDS) or stale-content
  // (server-side anti-join). Union of the scopes required by all four kinds.
  'query-admin-insights': {
    mcp: ['tableau:mcp:datasource:read'],
    api: new Set([
      'tableau:viz_data_service:read',
      'tableau:content:read',
      'tableau:mcp_site_settings:read',
      'tableau:users:read',
    ]),
  },
  // Dispatches on `resourceType` to workbook, datasource, or extract-refresh-task. Gated on a
  // single umbrella MCP scope (`tableau:mcp:content:delete`). Workbook and datasource paths still
  // route through resourceAccessChecker.
  'delete-content': {
    mcp: ['tableau:mcp:content:delete'],
    api: new Set([
      'tableau:workbooks:delete',
      'tableau:workbook_tags:update',
      'tableau:datasources:delete',
      'tableau:datasource_tags:update',
      'tableau:tasks:read',
      'tableau:tasks:delete',
      'tableau:users:read',
      ...RESOURCE_ACCESS_CHECKER_REQUIRED_API_SCOPES,
    ]),
  },
  // Admin-only, app-only confirm step for delete-content (MCP-Apps HITL). Invoked ONLY by a human gesture in the rendered iframe (visibility:['app']), never the model.
  'confirm-delete-content': {
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

async function getEnabledToolNames(): Promise<Set<WebToolName>> {
  const config = getConfig();
  const featureGate = getFeatureGate();
  const enabledTools = new Set<WebToolName>(Object.keys(toolScopeMap) as WebToolName[]);
  const mcpAppsEnabled = await featureGate.isFeatureEnabled('mcp-apps');

  // Remove disabled tools based on feature flags
  if (!config.adminToolsEnabled) {
    enabledTools.delete('list-extract-refresh-tasks');
    enabledTools.delete('update-cloud-extract-refresh-task');
    enabledTools.delete('confirm-update-cloud-extract-refresh-task');
    enabledTools.delete('confirm-delete-content');
    enabledTools.delete('list-jobs');
    enabledTools.delete('list-users');
    enabledTools.delete('update-user');
    enabledTools.delete('query-admin-insights');
    enabledTools.delete('delete-content');
  }

  // Remove the MCP-Apps-only tools if the mcp-apps feature is disabled. The confirm-* tools are the
  // human-gesture confirm steps for their preview tools and only exist when the iframe can render.
  if (!mcpAppsEnabled) {
    enabledTools.delete('get-embed-token');
    enabledTools.delete('confirm-update-cloud-extract-refresh-task');
    enabledTools.delete('confirm-delete-content');
  }

  // Flow tools are gated off by default (FLOW_TOOLS_ENABLED). When disabled they are not registered,
  // so their scopes must not be advertised or enforced either — otherwise a client could be asked to
  // hold scopes for tools that don't exist. Mirrors the adminToolsEnabled gating above.
  if (!config.flowToolsEnabled) {
    enabledTools.delete('list-flows');
    enabledTools.delete('get-flow');
  }

  return enabledTools;
}

export async function getSupportedMcpScopes(): Promise<McpScope[]> {
  const enabledTools = await getEnabledToolNames();
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

export async function getSupportedApiScopes(): Promise<TableauApiScope[]> {
  const enabledTools = await getEnabledToolNames();
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

export async function getSupportedScopes({
  includeApiScopes,
}: {
  includeApiScopes: boolean;
}): Promise<string[]> {
  const mcpScopes = await getSupportedMcpScopes();
  const apiScopes = await getSupportedApiScopes();
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
