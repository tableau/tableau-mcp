import { randomBytes } from 'crypto';
import { z } from 'zod';

import { UnsafeWorkspacePathError } from '../errors/mcpToolError.js';

const OPAQUE_ID_PATTERN = /^[0-9a-f]{32}$/;

/** Generate a path-safe, 128-bit opaque identifier. */
export function generateOpaqueId(): string {
  return randomBytes(16).toString('hex');
}

/** Return whether a value has the one accepted opaque-id representation. */
export function isOpaqueId(value: string): boolean {
  return OPAQUE_ID_PATTERN.test(value);
}

/**
 * The single, shared Zod schema for a tool's public `appId` parameter: strict 32 lowercase
 * hexadecimal digits, matching {@link isOpaqueId}/{@link parseOpaqueId}. Every data-app tool that
 * accepts an `appId` must use this schema rather than a re-declared regex or a looser `min(1)`
 * check, so the public parameter validation can never drift from the internal path-safety check.
 */
export const appIdSchema = z
  .string()
  .regex(OPAQUE_ID_PATTERN, 'appId must be exactly 32 lowercase hexadecimal digits')
  .describe('The opaque workspace handle returned by scaffold-data-app. Never a filesystem path.');

/**
 * Validate an opaque identifier before it participates in filesystem path construction.
 *
 * A single strict representation prevents traversal, platform-specific separators, NULs, absolute
 * paths, and alternate spellings from ever reaching `path.join`.
 */
export function parseOpaqueId(value: string, kind: 'appId' | 'validationId'): string {
  if (!isOpaqueId(value)) {
    throw new UnsafeWorkspacePathError(
      `Invalid ${kind}: expected 32 lowercase hexadecimal digits.`,
    );
  }
  return value;
}
