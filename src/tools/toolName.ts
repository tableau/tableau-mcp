export const toolNames = ['admin-users', 'admin-groups'] as const;
export type ToolName = (typeof toolNames)[number];

export const toolGroupNames = ['admin'] as const;
export type ToolGroupName = (typeof toolGroupNames)[number];

export const toolGroups = {
  admin: ['admin-users', 'admin-groups'],
} as const satisfies Record<ToolGroupName, Array<ToolName>>;

export function isToolName(value: unknown): value is ToolName {
  return !!toolNames.find((name) => name === value);
}

export function isToolGroupName(value: unknown): value is ToolGroupName {
  return !!toolGroupNames.find((name) => name === value);
}
