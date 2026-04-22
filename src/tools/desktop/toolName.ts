export const toolNames = ['placeholder-desktop-tool'] as const;
export type DesktopToolName = (typeof toolNames)[number];

export const toolGroupNames = ['placeholder'] as const;
export type ToolGroupName = (typeof toolGroupNames)[number];

export const toolGroups = {
  placeholder: ['placeholder-desktop-tool'],
} as const satisfies Record<ToolGroupName, Array<DesktopToolName>>;

export function isToolName(value: unknown): value is DesktopToolName {
  return !!toolNames.find((name) => name === value);
}

export function isToolGroupName(value: unknown): value is ToolGroupName {
  return !!toolGroupNames.find((name) => name === value);
}

export function getToolsFromValue(value: string): Array<DesktopToolName> {
  if (isToolName(value)) {
    return [value];
  }

  if (isToolGroupName(value)) {
    return toolGroups[value] ?? [];
  }

  return [];
}
