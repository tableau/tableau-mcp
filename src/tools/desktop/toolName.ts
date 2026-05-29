export const desktopToolNames = ['list-instances', 'check-for-user-changes'] as const;
export type DesktopToolName = (typeof desktopToolNames)[number];
