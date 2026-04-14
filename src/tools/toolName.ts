export const toolNames = [
  'admin-users',
  'admin-groups',
  'content-permissions',
  'content-projects',
  'content-workbooks',
  'content-views',
  'site-jobs',
  'tableau-operations',
] as const;
export type ToolName = (typeof toolNames)[number];

export const toolGroupNames = ['admin', 'content', 'operations'] as const;
export type ToolGroupName = (typeof toolGroupNames)[number];

export const toolGroups = {
  admin: ['admin-users', 'admin-groups'],
  content: ['content-projects', 'content-workbooks', 'content-views'],
  operations: ['content-permissions', 'site-jobs', 'tableau-operations'],
} as const satisfies Record<ToolGroupName, Array<ToolName>>;

export function isToolName(value: unknown): value is ToolName {
  return !!toolNames.find((name) => name === value);
}

export function isToolGroupName(value: unknown): value is ToolGroupName {
  return !!toolGroupNames.find((name) => name === value);
}
