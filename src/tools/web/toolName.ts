export const webToolNames = [
  'list-datasources',
  'list-extract-refresh-tasks',
  'list-workbooks',
  'list-projects',
  'list-views',
  'list-custom-views',
  'query-datasource',
  'get-datasource-metadata',
  'get-workbook',
  'get-view-data',
  'get-view-image',
  'get-custom-view-data',
  'get-custom-view-image',
  'list-all-pulse-metric-definitions',
  'list-pulse-metric-definitions-from-definition-ids',
  'list-pulse-metrics-from-metric-definition-id',
  'list-pulse-metrics-from-metric-ids',
  'list-pulse-metric-subscriptions',
  'generate-pulse-metric-value-insight-bundle',
  'generate-pulse-insight-brief',
  'search-content',
  'revoke-access-token',
  'reset-consent',
  'query-admin-insights-ts-events',
  'query-admin-insights-site-content',
  'get-stale-content-report',
] as const;
export type WebToolName = (typeof webToolNames)[number];

export const webToolGroupNames = [
  'datasource',
  'workbook',
  'project',
  'view',
  'pulse',
  'content-exploration',
  'tasks',
  'token-management',
  'admin-insights',
] as const;
export type WebToolGroupName = (typeof webToolGroupNames)[number];

export const webToolGroups = {
  datasource: ['list-datasources', 'get-datasource-metadata', 'query-datasource'],
  workbook: ['list-workbooks', 'get-workbook'],
  project: ['list-projects'],
  view: [
    'list-views',
    'list-custom-views',
    'get-view-data',
    'get-view-image',
    'get-custom-view-data',
    'get-custom-view-image',
  ],
  pulse: [
    'list-all-pulse-metric-definitions',
    'list-pulse-metric-definitions-from-definition-ids',
    'list-pulse-metrics-from-metric-definition-id',
    'list-pulse-metrics-from-metric-ids',
    'list-pulse-metric-subscriptions',
    'generate-pulse-metric-value-insight-bundle',
    'generate-pulse-insight-brief',
  ],
  'content-exploration': ['search-content'],
  tasks: ['list-extract-refresh-tasks'],
  'token-management': ['revoke-access-token', 'reset-consent'],
  'admin-insights': [
    'query-admin-insights-ts-events',
    'query-admin-insights-site-content',
    'get-stale-content-report',
  ],
} as const satisfies Record<WebToolGroupName, Array<WebToolName>>;

export function isWebToolName(value: unknown): value is WebToolName {
  return webToolNames.some((name) => name === value);
}

export function isWebToolGroupName(value: unknown): value is WebToolGroupName {
  return webToolGroupNames.some((name) => name === value);
}
