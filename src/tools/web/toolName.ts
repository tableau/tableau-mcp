export const webToolNames = [
  'list-datasources',
  'delete-datasource',
  'confirm-delete-datasource',
  'list-extract-refresh-tasks',
  'delete-extract-refresh-task',
  'confirm-delete-extract-refresh-task',
  'update-cloud-extract-refresh-task',
  'confirm-update-cloud-extract-refresh-task',
  'list-jobs',
  'list-users',
  'list-workbooks',
  'delete-workbook',
  'confirm-delete-workbook',
  'list-projects',
  'list-views',
  'list-custom-views',
  'query-datasource',
  'get-datasource-metadata',
  'get-embed-token',
  'get-workbook',
  'get-view',
  'get-view-data',
  'get-view-image',
  'get-custom-view-data',
  'get-custom-view-image',
  'list-all-pulse-metric-definitions',
  'list-pulse-metric-defs-from-def-ids',
  'list-pulse-metrics-from-metric-def-id',
  'list-pulse-metrics-from-metric-ids',
  'list-pulse-metric-subscriptions',
  'generate-pulse-insight-bundle',
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
  'jobs',
  'users',
  'token-management',
  'admin-insights',
] as const;
export type WebToolGroupName = (typeof webToolGroupNames)[number];

export const webToolGroups = {
  datasource: [
    'list-datasources',
    'get-datasource-metadata',
    'query-datasource',
    'delete-datasource',
    'confirm-delete-datasource',
  ],
  workbook: ['list-workbooks', 'get-workbook', 'delete-workbook', 'confirm-delete-workbook'],
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
    'list-pulse-metric-defs-from-def-ids',
    'list-pulse-metrics-from-metric-def-id',
    'list-pulse-metrics-from-metric-ids',
    'list-pulse-metric-subscriptions',
    'generate-pulse-insight-bundle',
    'generate-pulse-insight-brief',
  ],
  'content-exploration': ['search-content'],
  tasks: [
    'list-extract-refresh-tasks',
    'delete-extract-refresh-task',
    'confirm-delete-extract-refresh-task',
    'update-cloud-extract-refresh-task',
    'confirm-update-cloud-extract-refresh-task',
  ],
  jobs: ['list-jobs'],
  users: ['list-users'],
  'token-management': ['get-embed-token', 'revoke-access-token', 'reset-consent'],
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
