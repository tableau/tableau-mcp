/**
 * Route-safety core: pure TypeScript, no external dependencies.
 *
 * REST clients (Zodios, raw axios) paste path-parameter values into the request path verbatim,
 * and axios / the WHATWG URL parser then collapse dot-segments (`..`, `%2e%2e`, `..\`) before the
 * request leaves the process. An ID that is not strictly validated can therefore redirect a call
 * to a different REST endpoint than the one a tool is bound to (P1 "Route Traversal Bypass").
 *
 * This file holds the transport-agnostic primitives:
 *  - `assertSafePathSegment`: generic single-segment guard,
 *  - `assertNoTraversal`: raw-URL traversal check,
 *  - `buildRestPath`: safe path builder for raw (non-Zodios) calls.
 *
 * Zod schemas live in `./ids.ts`; the Zodios/axios wiring lives in `./zodios.ts`.
 */

export class RouteSafetyError extends Error {}

// Separators, query/fragment delimiters, `;` and control characters. Plain spaces are allowed: once
// encoded they cannot alter the route (e.g. knowledge node IDs like `field:Profit Ratio`).
// `;` is forbidden because Tableau's REST layer runs on Java/Tomcat, which strips `;`-delimited
// path parameters from a segment: `x;y` would be truncated to `x`, and `..;` is normalized to `..`.
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[/\\?#;\x00-\x1f\x7f]/;

// Axios's Node adapter resolves the URL through WHATWG `URL` (which normalizes `.` / `%2e` once)
// and the server decodes once more, so two decode passes is the realistic threat ceiling. A value
// that would still change on a third pass is treated as suspicious and rejected.
const MAX_DECODE_PASSES = 2;

/**
 * Decodes only well-formed `%XX` runs and never throws. After one decode, a stray `%` is a literal
 * percent sign (e.g. `field:Profit %`), not malformed input, so it is kept as-is. A run that is not
 * valid UTF-8 falls back to decoding its ASCII bytes individually, so an encoded `.` / `/` cannot
 * hide next to an invalid multi-byte sequence.
 */
const lenientDecode = (s: string): string =>
  s.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run.replace(/%([0-7][0-9a-f])/gi, (_m, hex: string) =>
        String.fromCharCode(parseInt(hex, 16)),
      );
    }
  });

/**
 * Percent-decodes up to `MAX_DECODE_PASSES` times so double-encoded payloads are exposed.
 *
 * - The first pass is strict: the raw value is what goes on the wire, so malformed encoding
 *   (e.g. `%zz`) is rejected.
 * - Later passes are lenient (see `lenientDecode`), so a legitimate value whose decoded form
 *   contains a literal `%` (sent as `%25`) is not a false positive.
 * - If another pass would still change the value, it is rejected as excessively encoded.
 */
export function fullyDecode(v: string): string {
  let cur: string;
  try {
    cur = decodeURIComponent(v);
  } catch {
    throw new RouteSafetyError('Malformed percent-encoding in REST route');
  }
  for (let pass = 1; pass < MAX_DECODE_PASSES; pass++) {
    cur = lenientDecode(cur);
  }
  if (lenientDecode(cur) !== cur) {
    throw new RouteSafetyError('Excessive percent-encoding in REST route');
  }
  return cur;
}

/** True for `.` / `..`, including Tomcat's `..;params` form. */
const isDotSegment = (s: string): boolean => {
  const bare = s.split(';', 1)[0];
  return bare === '.' || bare === '..';
};

/**
 * Throws unless `value` is safe to use as a single REST path segment. Returns the raw value.
 *
 * Accepts both decoded and percent-encoded input (Zodios interpolates path params verbatim, so a
 * pre-encoded value such as `definitions%3AbatchGet` is legitimate here). The check runs on the
 * decoded form; the returned value is the raw input, unmodified.
 */
export function assertSafePathSegment(name: string, value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new RouteSafetyError(`Path parameter '${name}' must be a string`);
  }
  const raw = String(value);
  const d = fullyDecode(raw);
  if (!raw || FORBIDDEN.test(d) || isDotSegment(d)) {
    throw new RouteSafetyError(`Path parameter '${name}' is not a valid route segment`);
  }
  return raw;
}

/** Throws if the (query/fragment-stripped, fully decoded) URL path contains `.` / `..` segments. */
export function assertNoTraversal(url: string): void {
  const path = fullyDecode(url.split(/[?#]/, 1)[0]).replace(/\\/g, '/');
  if (path.split('/').some(isDotSegment)) {
    throw new RouteSafetyError('REST route contains traversal segments');
  }
}

const PERCENT_ESCAPE = /%[0-9a-f]{2}/i;

/**
 * Raw (non-Zodios) calls: validated, individually encoded segments.
 * Query parameters go in axios `params`, never in the path.
 *
 * Contract: segments must be DECODED values (e.g. `definitions:batchGet`, not
 * `definitions%3AbatchGet`). Each segment is encoded exactly once here; a segment that already
 * contains a `%XX` escape is rejected rather than silently double-encoded into `%253A`.
 */
export const buildRestPath = (...segments: string[]): string =>
  '/' +
  segments
    .map((s) => {
      if (PERCENT_ESCAPE.test(s)) {
        throw new RouteSafetyError(
          'buildRestPath expects decoded path segments, not percent-encoded ones',
        );
      }
      // Validate the encoded form: that is exactly what goes on the wire.
      return assertSafePathSegment('segment', encodeURIComponent(s));
    })
    .join('/');
