/**
 * Route-safety guards for the Tableau REST SDK.
 *
 * Zodios pastes `:param` values into the request path verbatim, and axios / the WHATWG URL parser
 * then collapse dot-segments (`..`, `%2e%2e`, `..\`) before the request leaves the process. An ID
 * that is not strictly validated can therefore redirect a call to a different REST endpoint than
 * the one a tool is bound to (P1 "Route Traversal Bypass"). This module provides:
 *  - strict LUID schemas for ID parameters,
 *  - a generic path-segment guard (Zodios plugin) applied to every SDK client,
 *  - a raw-URL traversal check (axios interceptor),
 *  - a safe path builder for the few raw (non-Zodios) axios calls.
 */
import { ZodiosPlugin } from '@zodios/core';
import { z } from 'zod';

/** Tableau LUID (UUID). Validated on the raw value; never decoded first. */
export const luidSchema = z.string().uuid('must be a Tableau LUID (UUID format)');

/** Zodios endpoint parameter definition for a strictly-validated LUID path parameter. */
export const luidPathParam = <N extends string>(name: N) =>
  ({ name, type: 'Path', schema: luidSchema }) as const;

export class RouteSafetyError extends Error {}

// Separators, query/fragment delimiters and control characters. Plain spaces are allowed: once
// encoded they cannot alter the route (e.g. knowledge node IDs like `field:Profit Ratio`).
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[/\\?#\x00-\x1f\x7f]/;
const MAX_DECODE_PASSES = 3;

/** Percent-decodes until stable so double/triple-encoded payloads are exposed. */
export function fullyDecode(v: string): string {
  let cur = v;
  for (let i = 0; i < MAX_DECODE_PASSES; i++) {
    let next: string;
    try {
      next = decodeURIComponent(cur);
    } catch {
      throw new RouteSafetyError('Malformed percent-encoding in REST route');
    }
    if (next === cur) return cur;
    cur = next;
  }
  throw new RouteSafetyError('Excessive percent-encoding in REST route');
}

/** Throws unless `value` is safe to use as a single REST path segment. Returns the raw value. */
export function assertSafePathSegment(name: string, value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new RouteSafetyError(`Path parameter '${name}' must be a string`);
  }
  const raw = String(value);
  const d = fullyDecode(raw);
  if (!raw || FORBIDDEN.test(d) || d === '.' || d === '..') {
    throw new RouteSafetyError(`Path parameter '${name}' is not a valid route segment`);
  }
  return raw;
}

/** Throws if the (query/fragment-stripped, fully decoded) URL path contains `.` / `..` segments. */
export function assertNoTraversal(url: string): void {
  const path = fullyDecode(url.split(/[?#]/, 1)[0]).replace(/\\/g, '/');
  if (path.split('/').some((s) => s === '.' || s === '..')) {
    throw new RouteSafetyError('REST route contains traversal segments');
  }
}

/**
 * Raw (non-Zodios) calls: validated, individually encoded segments.
 * Query parameters go in axios `params`, never in the path.
 */
export const buildRestPath = (...segments: string[]): string =>
  '/' + segments.map((s) => encodeURIComponent(assertSafePathSegment('segment', s))).join('/');

export const pathParamGuardPlugin: ZodiosPlugin = {
  name: 'path-param-guard',
  request: async (_api, config) => {
    for (const [k, v] of Object.entries(config.params ?? {})) {
      assertSafePathSegment(k, v);
    }
    return config;
  },
};
