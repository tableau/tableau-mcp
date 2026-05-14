export const desktopToolNames = ['list-instances'] as const;
export type DesktopToolName = (typeof desktopToolNames)[number];

export function isDesktopToolName(value: unknown): value is DesktopToolName {
  return desktopToolNames.some((name) => name === value);
}
