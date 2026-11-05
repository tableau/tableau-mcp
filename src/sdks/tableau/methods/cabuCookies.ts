/**
 * Captures and replays CABU's signed context cookie (`cabuCtx`, or sliced variants `cabuCtx.0`,
 * `cabuCtx.1`, ...) across the start-conversation / ask-utterance / stream-utterance calls that
 * make up one CABU turn. tableau-mcp builds a fresh HTTP client per tool call, so nothing carries
 * cookies across tool invocations the way a browser would -- see
 * `.work/specs/W-24280234-cabu-tools.md`'s cookie-dependent-state-strategy default. The CABU
 * conversation-state store (not this module) is what persists the array this returns between tool
 * calls.
 *
 * Values are carried as the complete raw `Set-Cookie` header strings axios hands back, never
 * url-decoded: tua-gaia's client found that decoding corrupts the signed value.
 */

/**
 * Pulls the raw `Set-Cookie` header value(s) off an axios response's `headers` object. Node's
 * `http`/`https` adapter folds repeated `Set-Cookie` headers into an array (CABU's sliced
 * `cabuCtx.0`/`cabuCtx.1` cookies send more than one); a single cookie may still arrive as a bare
 * string depending on the adapter, so both shapes are normalized to an array.
 */
export function extractSetCookies(headers: Record<string, unknown>): Array<string> {
  const raw = headers['set-cookie'];
  if (Array.isArray(raw)) {
    return raw.filter((value): value is string => typeof value === 'string');
  }
  if (typeof raw === 'string') {
    return [raw];
  }
  return [];
}

/**
 * Builds the `Cookie:` request header to replay captured cookies on the next call, keeping only
 * each cookie's `name=value` pair and dropping attributes (`Path`, `HttpOnly`, etc.) that are only
 * meaningful on a `Set-Cookie` response header. Returns `undefined` for an empty list so callers
 * can spread it into a headers object without sending an empty `Cookie` header.
 */
export function toCookieHeader(cookies: Array<string>): string | undefined {
  if (cookies.length === 0) {
    return undefined;
  }
  return cookies.map((cookie) => cookie.split(';')[0].trim()).join('; ');
}
