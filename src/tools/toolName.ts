export const toolNames = [
  'list-datasources',
  'list-fields',
  'query-datasource',
  'query-workbooks',
  'read-metadata',
] as const;
export type ToolName = (typeof toolNames)[number];

export function isToolName(value: unknown): value is ToolName {
  return !!toolNames.find((name) => name === value);
}
