export const webToolNames = [
  'list-datasources',
  'list-extract-refresh-tasks',
  'update-cloud-extract-refresh-task',
  'confirm-update-cloud-extract-refresh-task',
  'list-jobs',
  'list-users',
  'list-workbooks',
  'list-projects',
  'list-views',
  'list-custom-views',
  'list-flows',
  'query-datasource',
  'get-datasource-metadata',
  'resolve-datasource-luid',
  'get-embed-token',
  'record-event',
  'get-workbook',
  'get-view',
  'get-flow',
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
  'generate-insight-cards',
  'search-content',
  'revoke-access-token',
  'reset-consent',
  'query-admin-insights',
  'update-user',
  'delete-content',
  'confirm-delete-content',
] as const;
export type WebToolName = (typeof webToolNames)[number];

export const webToolGroupNames = [
  'datasource',
  'workbook',
  'project',
  'view',
  'flow',
  'pulse',
  'insights',
  'content-exploration',
  'tasks',
  'jobs',
  'users',
  'token-management',
  'admin-insights',
  'content',
] as const;
export type WebToolGroupName = (typeof webToolGroupNames)[number];

export const webToolGroups = {
  datasource: [
    'list-datasources',
    'get-datasource-metadata',
    'resolve-datasource-luid',
    'query-datasource',
  ],
  workbook: ['list-workbooks', 'get-workbook'],
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
  flow: ['list-flows', 'get-flow'],
  pulse: [
    'list-all-pulse-metric-definitions',
    'list-pulse-metric-definitions-from-definition-ids',
    'list-pulse-metrics-from-metric-definition-id',
    'list-pulse-metrics-from-metric-ids',
    'list-pulse-metric-subscriptions',
    'generate-pulse-metric-value-insight-bundle',
    'generate-pulse-insight-brief',
  ],
  insights: ['generate-insight-cards'],
  'content-exploration': ['search-content'],
  tasks: [
    'list-extract-refresh-tasks',
    'update-cloud-extract-refresh-task',
    'confirm-update-cloud-extract-refresh-task',
  ],
  jobs: ['list-jobs'],
  users: ['list-users', 'update-user'],
  'token-management': ['get-embed-token', 'record-event', 'revoke-access-token', 'reset-consent'],
  'admin-insights': ['query-admin-insights'],
  content: ['delete-content', 'confirm-delete-content'],
} as const satisfies Record<WebToolGroupName, Array<WebToolName>>;

export function isWebToolName(value: unknown): value is WebToolName {
  return webToolNames.some((name) => name === value);
}

export function isWebToolGroupName(value: unknown): value is WebToolGroupName {
  return webToolGroupNames.some((name) => name === value);
}
