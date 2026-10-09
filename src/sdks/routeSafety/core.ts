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
 *  - `assertLuid`: strict LUID guard for SDK code that builds paths itself,
 *  - `assertSafeRequestUrl`: final-URL guard for the axios request interceptor,
 *  - `buildRestPath`: safe path builder for raw (non-Zodios) calls.
 *
 * Every rejection throws `RouteSafetyError`, whose message names the parameter but never echoes the
 * rejected value. Zod schemas live in `./ids.ts`; the Zodios/axios wiring lives in `./zodios.ts`.
 */

export class RouteSafetyError extends Error {
  override name = 'RouteSafetyError';
}

/** Tableau LUID: 8-4-4-4-12 hex digits, any case. Deliberately not RFC 9562 version-checked. */
export const LUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Checked on the RAW value (what goes on the wire): separators, query/fragment delimiters, `;`,
// space and control characters. Callers that need any of these must percent-encode them first.
// - Space and C0 controls: WHATWG URL strips tab/LF/CR anywhere and trims leading/trailing C0
//   controls and spaces, so `.. ` or `.\t.` would become `..` after this check.
// - `;`: Tableau's REST layer runs on Java/Tomcat, which strips `;`-delimited path parameters from
//   a raw segment: `x;y` would be truncated to `x`, and `..;` is normalized to `..`.
// eslint-disable-next-line no-control-regex
const RAW_FORBIDDEN = /[/\\?#;\x00-\x20\x7f]/;

// Checked on the DECODED value. Once encoded, `?`, `#`, `;` and spaces cannot change the route (e.g.
// knowledge node IDs like `field:Is Returned?`). Encoded `/` and `\` (`%2F` / `%5C`, at any encoding
// depth) are still rejected: proxies and some servers decode them into real separators.
// eslint-disable-next-line no-control-regex
const DECODED_FORBIDDEN = /[/\\\x00-\x1f\x7f]/;

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

/**
 * True if `s` resolves to `.` / `..` under WHATWG URL semantics (tab/LF/CR stripped anywhere,
 * leading/trailing C0 controls and spaces trimmed) or Tomcat's `..;params` form.
 */
const isDotSegment = (s: string): boolean => {
  const bare = s
    .replace(/[\t\n\r]/g, '')
    .split(';', 1)[0]
    // eslint-disable-next-line no-control-regex
    .replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '');
  return bare === '.' || bare === '..';
};

const invalidSegment = (name: string): RouteSafetyError =>
  new RouteSafetyError(`Path parameter '${name}' is not a valid route segment`);

/**
 * Throws unless `value` is safe to use as a single REST path segment. Returns the raw value.
 *
 * Accepts both decoded and percent-encoded input (Zodios interpolates path params verbatim, so a
 * pre-encoded value such as `field%3AIs%20Returned%3F` is legitimate here):
 *  - the raw value must not contain separators, `?`, `#`, `;`, spaces or control characters,
 *  - the decoded value must not contain `/`, `\` or control characters, or be a dot segment.
 */
export function assertSafePathSegment(name: string, value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new RouteSafetyError(`Path parameter '${name}' must be a string`);
  }
  const raw = String(value);
  if (!raw || RAW_FORBIDDEN.test(raw)) {
    throw invalidSegment(name);
  }
  const decoded = fullyDecode(raw);
  if (DECODED_FORBIDDEN.test(decoded) || isDotSegment(decoded)) {
    throw invalidSegment(name);
  }
  return raw;
}

/** Throws unless `value` is a Tableau LUID. Returns the value. */
export function assertLuid(name: string, value: unknown): string {
  if (typeof value !== 'string' || !LUID_PATTERN.test(value)) {
    throw new RouteSafetyError(`Path parameter '${name}' must be a Tableau LUID (UUID format)`);
  }
  return value;
}

/** Throws if the (fully decoded) URL path contains `.` / `..` segments. */
export function assertNoTraversal(url: string): void {
  const path = fullyDecode(url).replace(/\\/g, '/');
  if (path.split('/').some(isDotSegment)) {
    throw new RouteSafetyError('REST route contains traversal segments');
  }
}

// RFC 3986 path characters: pchar (unreserved, pct-encoded, sub-delims, `:`, `@`) plus `/`, minus
// `;`, which servlet containers such as Tomcat treat as a path-parameter delimiter and strip
// (buildRestPath and every Zodios path param send it as `%3B`). None of these is re-encoded or
// stripped by WHATWG URL, so for an allowed URL the only way the resolved pathname can differ from
// the naive concatenation is dot-segment collapsing.
const PATH_CHARS = /^[A-Za-z0-9\-._~!$&'()*+,=:@%/]*$/;

/**
 * Final-URL guard for the axios request interceptor. Checks the URL axios will actually send:
 *  - `url` must be a path relative to `baseURL` (no absolute or protocol-relative URL),
 *  - `url` must contain only RFC 3986 path characters: no literal `?` / `#` (queries belong in
 *    axios `params`), `;`, `\`, spaces, control or non-ASCII characters,
 *  - `url` must not contain an empty segment (`//`),
 *  - the decoded path must not contain dot segments,
 *  - resolving it against `baseURL` with WHATWG `URL` (as axios's Node adapter does) must keep the
 *    origin and yield exactly the naive concatenation, i.e. normalization changed nothing.
 */
export function assertSafeRequestUrl(url: string | undefined, baseURL: string | undefined): void {
  if (!url || !url.startsWith('/') || url.startsWith('//')) {
    throw new RouteSafetyError('REST route must be a path relative to the API base URL');
  }
  if (!PATH_CHARS.test(url)) {
    throw new RouteSafetyError('REST route contains characters that are not allowed in a path');
  }
  // An empty segment shifts every later segment, and some servers and proxies collapse `//`.
  if (url.includes('//')) {
    throw new RouteSafetyError('REST route contains an empty path segment');
  }
  assertNoTraversal(url);
  if (!baseURL) {
    throw new RouteSafetyError('REST route has no API base URL to resolve against');
  }

  let base: URL;
  let resolved: URL;
  const trimmedBase = baseURL.replace(/\/+$/, '');
  try {
    base = new URL(baseURL);
    // Same join as axios's `combineURLs`.
    resolved = new URL(trimmedBase + url);
  } catch {
    throw new RouteSafetyError('REST route could not be resolved against the API base URL');
  }
  const expectedPath = base.pathname.replace(/\/+$/, '') + url;
  if (resolved.origin !== base.origin || resolved.pathname !== expectedPath) {
    throw new RouteSafetyError('REST route changed under URL normalization');
  }
}

const PERCENT_ESCAPE = /%[0-9a-f]{2}/i;

/**
 * Encodes one decoded segment. Same as `encodeURIComponent`, except `:` is left as-is: it is a
 * legal RFC 3986 `pchar` in any segment of an absolute path, WHATWG URL does not touch it, and
 * Tableau-issued IDs use it (upload session IDs `NNNN:HEX-N:N`, Pulse `definitions:batchGet`), so
 * keeping it literal sends exactly what those endpoints are documented with.
 */
const encodeSegment = (s: string): string => encodeURIComponent(s).replace(/%3A/g, ':');

/**
 * Raw (non-Zodios) calls: validated, individually encoded segments.
 * Query parameters go in axios `params`, never in the path.
 *
 * Contract: segments must be DECODED values (e.g. `definitions:batchGet`, not
 * `definitions%3AbatchGet`). Each segment is encoded exactly once here; a segment that already
 * contains a `%XX` escape is rejected rather than silently double-encoded into `%253A`.
 * Errors name the offending segment by its index in the argument list.
 */
export const buildRestPath = (...segments: string[]): string =>
  '/' +
  segments
    .map((s, i) => {
      const name = `segment ${i}`;
      if (PERCENT_ESCAPE.test(s)) {
        throw new RouteSafetyError(
          `buildRestPath expects decoded path segments, not percent-encoded ones ('${name}')`,
        );
      }
      let encoded: string;
      try {
        encoded = encodeSegment(s);
      } catch {
        // `encodeURIComponent` throws URIError on a lone surrogate.
        throw invalidSegment(name);
      }
      // Validate the encoded form: that is exactly what goes on the wire.
      return assertSafePathSegment(name, encoded);
    })
    .join('/');
