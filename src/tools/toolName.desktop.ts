export const toolNames = ['placeholder-desktop-tool'] as const;
export type ToolName = (typeof toolNames)[number];

export const toolGroupNames = ['placeholder'] as const;
export type ToolGroupName = (typeof toolGroupNames)[number];

export const toolGroups = {
  placeholder: ['placeholder-desktop-tool'],
} as const satisfies Record<ToolGroupName, Array<ToolName>>;

export function isToolName(value: unknown): value is ToolName {
  return !!toolNames.find((name) => name === value);
}

export function isToolGroupName(value: unknown): value is ToolGroupName {
  return !!toolGroupNames.find((name) => name === value);
}

export function getToolsFromValue(value: string): Array<ToolName> {
  if (isToolName(value)) {
    return [value];
  }

  if (isToolGroupName(value)) {
    return toolGroups[value] ?? [];
  }

  return [];
}
