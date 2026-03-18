export const buildConfigurations = ['default', 'experimental'] as const;
export type BuildConfiguration = (typeof buildConfigurations)[number];
export function isBuildConfiguration(value: unknown): value is BuildConfiguration {
  return buildConfigurations.some((c) => c === value);
}
