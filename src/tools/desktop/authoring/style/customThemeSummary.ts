export type CustomThemeSummary = {
  readonly schemaVersion: '1.0.0';
  readonly propertyGroups: string[];
};

export function summarizeCustomTheme(value: Record<string, unknown>): CustomThemeSummary {
  const styles = value.styles as Record<string, unknown>;
  return {
    schemaVersion: '1.0.0',
    propertyGroups: Object.keys(styles).sort(),
  };
}
