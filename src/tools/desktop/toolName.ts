export const desktopToolNames = [
  'list-instances',
  'check-for-user-changes',
  'get-workbook-xml',
  'apply-workbook',
  'list-worksheets',
  'list-dashboards',
  'get-worksheet-xml',
  'apply-worksheet',
  'get-dashboard-xml',
  'apply-dashboard',
  'apply-dashboard-with-viewpoints',
  'build-and-apply-dashboard',
] as const;
export type DesktopToolName = (typeof desktopToolNames)[number];

export function isDesktopToolName(value: unknown): value is DesktopToolName {
  return desktopToolNames.some((name) => name === value);
}
