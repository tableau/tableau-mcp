export const desktopToolNames = [
  'list-instances',
  'check-for-user-changes',
  'get-workbook-xml',
  'apply-workbook',
] as const;
export type DesktopToolName = (typeof desktopToolNames)[number];

export function isDesktopToolName(value: unknown): value is DesktopToolName {
  return desktopToolNames.some((name) => name === value);
}
