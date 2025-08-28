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
] as const;
export type ToolName = (typeof toolNames)[number];

export function isToolName(value: unknown): value is ToolName {
  return !!toolNames.find((name) => name === value);
}
