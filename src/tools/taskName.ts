import { ToolGroupName, ToolName } from './toolName.js';

export const taskNames = [
  'Data Analysis',
  'Workbook Visualization',
  'Content Management',
  'Pulse',
] as const;
export type TaskName = (typeof taskNames)[number];

export const taskNamesToTools = {
  'Data Analysis': ['list-datasources', 'list-fields', 'query-datasource', 'read-metadata'],
  'Workbook Visualization': [
    'list-workbooks',
    'get-workbook',
    'list-views',
    'get-view-data',
    'get-view-image',
  ],
  'Content Management': ['workbook', 'view', 'list-datasources'],
  Pulse: [
    'list-all-pulse-metric-definitions',
    'list-pulse-metric-definitions-from-definition-ids',
    'list-pulse-metrics-from-metric-definition-id',
    'list-pulse-metrics-from-metric-ids',
    'list-pulse-metric-subscriptions',
    'generate-pulse-metric-value-insight-bundle',
  ],
} as const satisfies Record<TaskName, Array<ToolName | ToolGroupName>>;

export function isTaskName(value: unknown): value is TaskName {
  return !!taskNames.find((name) => name === value);
}
