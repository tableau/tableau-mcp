import { z } from 'zod';

/**
 * Shared zod factories for the parameter shapes that recur across the Desktop surface.
 * Param KEYS stay per-tool (dashboardName vs storyboard); only the value schemas and
 * their descriptions unify here. Descriptions must not name registered tools
 * (paramOriginDescriptions gate), must not say "XML" (Tableau-vocabulary gate), and
 * every added byte counts against the tools/list surface budgets — keep them terse.
 */

type ArtifactParamKind = 'workbook' | 'worksheet' | 'dashboard' | 'storyboard';

export function sessionParam(options: { max?: number } = {}): z.ZodOptional<z.ZodString> {
  const base = options.max === undefined ? z.string() : z.string().max(options.max);
  return base.optional().describe('Session ID; optional if pinned or unique.');
}

export function xmlModeParam(): z.ZodDefault<z.ZodOptional<z.ZodEnum<['file', 'inline']>>> {
  return z
    .enum(['file', 'inline'])
    .optional()
    .default('file')
    .describe(
      "'file' (default) saves to a cache file and returns its path; " +
        "'inline' returns the content unless it exceeds the inline cap.",
    );
}

export function artifactNameParam(
  kind: ArtifactParamKind,
  options: { min?: number; max?: number } = {},
): z.ZodString {
  let base = z.string();
  if (options.min !== undefined) {
    base = base.min(options.min);
  }
  if (options.max !== undefined) {
    base = base.max(options.max);
  }
  return base.describe(`${capitalize(kind)} name/id.`);
}

export function artifactFileParam(
  kind: ArtifactParamKind,
  options: { max?: number } = {},
): z.ZodString {
  const base = options.max === undefined ? z.string() : z.string().max(options.max);
  return base.describe(`Cached ${kind} file path.`);
}

function capitalize(kind: ArtifactParamKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}
