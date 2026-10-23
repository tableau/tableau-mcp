import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { ExecuteCommandWarning } from '../../../desktop/externalApi/executorTypes.js';
import { formatDesktopWarnings } from '../../../desktop/validation/promise-check.js';
import {
  getStructuredContent,
  jsonToolResult,
  type StructuredResult,
  withNextAction,
} from '../structuredContent.js';
import { desktopWarningNextAction, type WithDesktopWarnings } from './applyPreamble.js';

/** Desktop's warnings as the `{code, message}` pairs the result envelope carries. */
export function toWireWarnings(
  warnings: readonly ExecuteCommandWarning[] | undefined,
): ExecuteCommandWarning[] {
  return (warnings ?? []).map(({ code, message }) => ({ code, message }));
}

/**
 * Result for a Desktop command that is not an apply: a clean result is the body unchanged; a
 * warned one never reads as success, so it gets a "but Desktop reported N warning(s)" headline,
 * the warnings, and a next action that is not done. An existing next action wins.
 */
export function commandOk<T extends { message: string }>(
  body: T,
  commandResult: { readonly warnings?: readonly ExecuteCommandWarning[] },
  subject: string,
  warnedNote = '',
): WithDesktopWarnings<T> {
  const warnings = toWireWarnings(commandResult.warnings);
  if (warnings.length === 0) return body;

  const warned = {
    ...body,
    message: `${subject}, but Desktop reported ${warnings.length} warning(s).${warnedNote}${formatDesktopWarnings(warnings, '')}`,
    warnings,
  };
  return getStructuredContent(body) === undefined
    ? withNextAction(warned, desktopWarningNextAction())
    : warned;
}

/** getSuccessResult for the tools that use commandOk, so the next action reaches the client. */
export function commandSuccessResult<T extends object>(
  result: StructuredResult<T>,
): CallToolResult {
  return jsonToolResult(result, { isError: false });
}
