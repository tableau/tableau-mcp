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
  'list-available-fields',
  'list-fields',
  'add-field-to-encoding',
  'add-field-to-rows',
  'add-field-to-cols',
  'remove-field-from-encoding',
  'remove-field-from-rows',
  'remove-field-from-cols',
  'resolve-field',
  'search-examples',
  'search-commands',
  'lookup-workbook-schema',
  'search-workbook-examples',
  'execute-tableau-command',
] as const;
export type DesktopToolName = (typeof desktopToolNames)[number];

export function isDesktopToolName(value: unknown): value is DesktopToolName {
  return desktopToolNames.some((name) => name === value);
}
