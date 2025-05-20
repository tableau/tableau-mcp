export const toolNames = ['query-datasource', 'list-fields', 'read-metadata'] as const;
export type ToolName = (typeof toolNames)[number];

export function isToolName(value: unknown): value is ToolName {
  return !!toolNames.find((name) => name === value);
}
