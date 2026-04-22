export const desktopToolNames = ['placeholder-desktop-tool'] as const;
export type DesktopToolName = (typeof desktopToolNames)[number];

export const desktopToolGroupNames = ['placeholder'] as const;
export type DesktopToolGroupName = (typeof desktopToolGroupNames)[number];

export const desktopToolGroups = {
  placeholder: ['placeholder-desktop-tool'],
} as const satisfies Record<DesktopToolGroupName, Array<DesktopToolName>>;

export function isDesktopToolName(value: unknown): value is DesktopToolName {
  return !!desktopToolNames.find((name) => name === value);
}

export function isDesktopToolGroupName(value: unknown): value is DesktopToolGroupName {
  return !!desktopToolGroupNames.find((name) => name === value);
}

export function getToolsFromValue(value: string): Array<DesktopToolName> {
  if (isDesktopToolName(value)) {
    return [value];
  }

  if (isDesktopToolGroupName(value)) {
    return desktopToolGroups[value] ?? [];
  }

  return [];
}
