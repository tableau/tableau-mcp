export const webToolNames = [
  'list-datasources',
  'list-extract-refresh-tasks',
  'delete-extract-refresh-task',
  'list-users',
  'list-workbooks',
  'delete-workbook',
  'list-projects',
  'list-views',
  'list-custom-views',
  'query-datasource',
  'get-datasource-metadata',
  'get-oauth-token',
  'get-workbook',
  'get-view',
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
  'query-admin-insights-job-performance',
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
  'users',
  'token-management',
  'admin-insights',
] as const;
export type WebToolGroupName = (typeof webToolGroupNames)[number];

export const webToolGroups = {
  datasource: ['list-datasources', 'get-datasource-metadata', 'query-datasource'],
  workbook: ['list-workbooks', 'get-workbook', 'delete-workbook'],
  project: ['list-projects'],
  view: [
    'list-views',
    'list-custom-views',
    'get-view',
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
  tasks: ['list-extract-refresh-tasks', 'delete-extract-refresh-task'],
  users: ['list-users'],
  'token-management': ['get-oauth-token', 'revoke-access-token', 'reset-consent'],
  'admin-insights': [
    'query-admin-insights-ts-events',
    'query-admin-insights-site-content',
    'query-admin-insights-job-performance',
    'get-stale-content-report',
  ],
} as const satisfies Record<WebToolGroupName, Array<WebToolName>>;

export function isWebToolName(value: unknown): value is WebToolName {
  return webToolNames.some((name) => name === value);
}

export function isWebToolGroupName(value: unknown): value is WebToolGroupName {
  return webToolGroupNames.some((name) => name === value);
}
