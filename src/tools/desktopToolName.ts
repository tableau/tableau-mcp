export const toolNames = [] as const;
export type ToolName = (typeof toolNames)[number];

export const toolGroupNames = [] as const;
export type ToolGroupName = (typeof toolGroupNames)[number];

export const toolGroups = {} as const satisfies Record<ToolGroupName, Array<ToolName>>;

export function isToolName(value: unknown): value is ToolName {
  return !!toolNames.find((name) => name === value);
}

export function isToolGroupName(value: unknown): value is ToolGroupName {
  return !!toolGroupNames.find((name) => name === value);
}
