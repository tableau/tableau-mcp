export const toolNames = [
  'list-datasources',
  'list-fields',
  'list-workbooks',
  'list-views',
  'query-datasource',
  'read-metadata',
  'get-workbook',
  'get-view-data',
  'get-view-image',
  'list-all-pulse-metric-definitions',
  'list-pulse-metric-definitions-from-definition-ids',
  'list-pulse-metrics-from-metric-definition-id',
  'list-pulse-metrics-from-metric-ids',
  'list-pulse-metric-subscriptions',
  'generate-pulse-metric-value-insight-bundle',
  'generate-insight-brief',
] as const;
export type ToolName = (typeof toolNames)[number];

export const toolGroupNames = ['datasource', 'workbook', 'view', 'pulse'] as const;
export type ToolGroupName = (typeof toolGroupNames)[number];

export const toolGroups = {
  datasource: ['list-datasources', 'list-fields', 'query-datasource', 'read-metadata'],
  workbook: ['list-workbooks', 'get-workbook'],
  view: ['list-views', 'get-view-data', 'get-view-image'],
  pulse: [
    'list-all-pulse-metric-definitions',
    'list-pulse-metric-definitions-from-definition-ids',
    'list-pulse-metrics-from-metric-definition-id',
    'list-pulse-metrics-from-metric-ids',
    'list-pulse-metric-subscriptions',
    'generate-pulse-metric-value-insight-bundle',
    'generate-insight-brief',
  ],
} as const satisfies Record<ToolGroupName, Array<ToolName>>;

export function isToolName(value: unknown): value is ToolName {
  return !!toolNames.find((name) => name === value);
}

export function isToolGroupName(value: unknown): value is ToolGroupName {
  return !!toolGroupNames.find((name) => name === value);
}
