import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { ArgsValidationError } from '../../errors/mcpToolError.js';

/**
 * Shared zod factories for the parameter shapes that recur across the Desktop surface.
 * Param KEYS stay per-tool (dashboardName vs storyboard); only the value schemas and
 * their descriptions unify here. Descriptions must not name registered tools
 * (paramOriginDescriptions gate), must not say "XML" (Tableau-vocabulary gate), and
 * every added byte counts against the tools/list surface budgets — keep them terse.
 */

export type ArtifactParamKind =
  | 'workbook'
  | 'worksheet'
  | 'dashboard'
  | 'storyboard'
  | 'datasource';

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

/**
 * Legacy key kept as a working alias so the *Name renames are not breaking for
 * existing callers. Tools prefer the *Name key and error only when BOTH are absent.
 */
export function deprecatedArtifactAliasParam(kind: ArtifactParamKind): z.ZodOptional<z.ZodString> {
  return z.string().optional().describe(`Deprecated alias of ${kind}Name.`);
}

/**
 * Resolve the `<kind>Name` key against its deprecated bare-`<kind>` alias: the two keys
 * must not disagree, and by default one of them must be present. Pass
 * `{ allowMissing: true }` for optional selectors where both-absent is legal (the
 * conflict check still applies).
 */
export function resolveArtifactNameArg(
  kind: ArtifactParamKind,
  name: string | undefined,
  alias: string | undefined,
): Result<string, ArgsValidationError>;
export function resolveArtifactNameArg(
  kind: ArtifactParamKind,
  name: string | undefined,
  alias: string | undefined,
  options: { allowMissing: true },
): Result<string | undefined, ArgsValidationError>;
export function resolveArtifactNameArg(
  kind: ArtifactParamKind,
  name: string | undefined,
  alias: string | undefined,
  options?: { allowMissing?: boolean },
): Result<string | undefined, ArgsValidationError> {
  if (name !== undefined && alias !== undefined && name !== alias) {
    return new ArgsValidationError(
      `${kind}Name ("${name}") conflicts with its deprecated alias ${kind} ("${alias}"). ` +
        'Pass one of them.',
    ).toErr();
  }
  const resolved = name ?? alias;
  if (resolved === undefined && !options?.allowMissing) {
    return new ArgsValidationError(
      `${kind}Name is required (${kind} is a deprecated alias).`,
    ).toErr();
  }
  return new Ok(resolved);
}
