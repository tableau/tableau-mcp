export const buildModes = ['default', 'desktop'] as const;
export type BuildMode = (typeof buildModes)[number];
export function isBuildMode(value: unknown): value is BuildMode {
  return buildModes.some((mode) => mode === value);
}
