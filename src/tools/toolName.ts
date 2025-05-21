<<<<<<< Updated upstream
<<<<<<< HEAD
export const toolNames = ['list-datasources', 'query-datasource', 'list-fields', 'read-metadata'] as const;
=======
export const toolNames = ['list-fields', 'query-datasource', 'read-metadata'] as const;
>>>>>>> main
=======
export const toolNames = [
  'list-datasources',
  'query-datasource',
  'list-fields',
  'read-metadata',
] as const;
>>>>>>> Stashed changes
export type ToolName = (typeof toolNames)[number];

export function isToolName(value: unknown): value is ToolName {
  return !!toolNames.find((name) => name === value);
}
