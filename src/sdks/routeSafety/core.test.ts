import {
  assertLuid,
  assertSafePathSegment,
  assertSafeRequestUrl,
  buildRestPath,
  fullyDecode,
  RouteSafetyError,
} from './core.js';
import { luidSchema } from './ids.js';
import { pathParamGuardPlugin } from './zodios.js';

const LUID = '11111111-1111-1111-1111-111111111111';
const BASE = 'https://tableau.test/api/3.24';

const attacks: Array<[string, string]> = [
  ['dot-dot slash', '../x'],
  ['dot-dot', '..'],
  ['dot', '.'],
  ['encoded dot-dot', '%2e%2e/x'],
  ['mixed-case encoded dot', '.%2E/x'],
  ['mixed-case encoded all', '%2E%2e%2Fx'],
  ['encoded slash', '..%2fx'],
  ['double-encoded', '%252e%252e%252f'],
  ['excessive encoding', '%25252e'],
  ['backslash', '..\\x'],
  ['query hijack', 'a?b'],
  ['fragment', 'a#b'],
  ['tab', 'a\tb'],
  ['newline', '\n'],
  ['malformed encoding', '%zz'],
  ['empty', ''],
  ['report payload', '../workbooks/W1/content?includeExtract=true&x='],
  ['semicolon (Tomcat path param)', 'a;b'],
  ['tomcat dot-dot-semicolon', '..;'],
  ['encoded tomcat dot-dot-semicolon', '%2e%2e%3bx'],
  ['double-encoded slash behind a literal percent', '%252e%252e%25%252f'],
  ['encoded dot next to invalid UTF-8', '%25e2%252e%252e%252f'],
  // WHATWG URL strips tab/LF/CR and trims C0 controls and spaces before resolving dot segments.
  ['dot-dot with trailing space', '.. '],
  ['dot with trailing space', '. '],
  ['dot-dot split by a tab', '.\t.'],
  ['dot-dot with leading space', ' ..'],
  ['raw space', 'a b'],
  ['DEL', 'a\x7fb'],
  // The same dot segments, percent-encoded, are still dot segments once decoded.
  ['encoded dot-dot with trailing space', '%2e%2e%20'],
  ['encoded dot-dot split by a tab', '.%09.'],
  ['encoded control character', 'a%00b'],
  // Encoded separators at any encoding depth.
  ['encoded slash (upper case)', 'a%2Fb'],
  ['encoded backslash', 'a%5cb'],
  ['double-encoded backslash', 'a%255Cb'],
];

// Field names as `knowledgeMethods` sends them: `encodeURIComponent(nodeId)`.
const knowledgeNodeIds = {
  accepted: ['field:Is Returned?', 'Order #', 'x;y', 'field:Profit Ratio', 'field:Profit %'],
  // Encoded `/` and `\` are rejected even though they cannot change the route on their own:
  // proxies and some servers decode `%2F` / `%5C` into real separators.
  rejected: ['Profit/Sales', 'a\\b'],
};

describe('routeSafety', () => {
  describe('assertSafePathSegment', () => {
    it.each(attacks)('rejects %s', (_n, payload) => {
      expect(() => assertSafePathSegment('p', payload)).toThrow(RouteSafetyError);
    });

    it('rejects non-string values', () => {
      expect(() => assertSafePathSegment('p', undefined)).toThrow(RouteSafetyError);
      expect(() => assertSafePathSegment('p', {})).toThrow(RouteSafetyError);
    });

    it('names the parameter but never echoes the value', () => {
      expect(() => assertSafePathSegment('viewId', '../secret')).toThrow(
        "Path parameter 'viewId' is not a valid route segment",
      );
    });

    it.each([
      LUID,
      'exp',
      'definitions%3AbatchGet',
      'a%3Ab',
      'field%3AProfit%20Ratio',
      'my-site',
      // A literal `%` in the decoded value (sent as `%25`) must not be a false positive.
      'field%3AProfit%20%25',
      '100%25',
      // Double-encoded but harmless: decodes to `a%41` then `aA`, stable after two passes.
      'a%2541',
      // Dots that are not a whole segment.
      'a.b',
      '...',
      '%2e%2e%2e',
    ])('accepts %s', (v) => {
      expect(assertSafePathSegment('p', v)).toBe(v);
    });

    it.each(knowledgeNodeIds.accepted)('accepts the encoded knowledge node ID for %j', (id) => {
      const encoded = encodeURIComponent(id);
      expect(assertSafePathSegment('node_id', encoded)).toBe(encoded);
    });

    it.each(knowledgeNodeIds.rejected)('rejects the encoded knowledge node ID for %j', (id) => {
      expect(() => assertSafePathSegment('node_id', encodeURIComponent(id))).toThrow(
        RouteSafetyError,
      );
    });
  });

  describe('assertLuid', () => {
    it('accepts a LUID in any case', () => {
      expect(assertLuid('viewId', LUID)).toBe(LUID);
      expect(assertLuid('viewId', 'ABCDEF01-2345-6789-abcd-ef0123456789')).toBe(
        'ABCDEF01-2345-6789-abcd-ef0123456789',
      );
    });

    it.each([...attacks.map(([, p]) => p), 'view-123', `${LUID}/x`, `${LUID} `, 42, undefined])(
      'rejects %j with a RouteSafetyError',
      (v) => {
        expect(() => assertLuid('viewId', v)).toThrow(
          new RouteSafetyError("Path parameter 'viewId' must be a Tableau LUID (UUID format)"),
        );
      },
    );
  });

  describe('fullyDecode', () => {
    it('decodes at most twice', () => {
      expect(fullyDecode('%252e')).toBe('.');
    });

    it('keeps a literal % that is no longer decodable instead of throwing', () => {
      expect(fullyDecode('field%3AProfit%20%25')).toBe('field:Profit %');
    });

    it('rejects a value that is still changing after two passes', () => {
      expect(() => fullyDecode('%25252e')).toThrow('Excessive percent-encoding');
    });

    it('rejects malformed encoding in the raw (on-the-wire) value', () => {
      expect(() => fullyDecode('%zz')).toThrow('Malformed percent-encoding');
    });
  });

  describe('assertSafeRequestUrl', () => {
    it.each([
      ['literal dot-dot', '/sites/S/views/../workbooks/W/content'],
      ['encoded dot-dot', '/sites/S/views/%2e%2e/workbooks'],
      ['mixed-case encoded dot', '/sites/S/views/.%2E/x'],
      ['backslash', '/sites/S/views/..\\x'],
      ['double-encoded dot-dot', '/sites/S/views/%252e%252e/x'],
      ['malformed encoding', '/sites/S/views/%zz/x'],
      ['tomcat dot-dot-semicolon', '/sites/S/views/..;/workbooks'],
      ['tomcat dot-dot-semicolon with params', '/sites/S/views/..;jsessionid=x/workbooks'],
      ['encoded tomcat dot-dot-semicolon', '/sites/S/views/%2e%2e%3b/workbooks'],
      ['tab inside dot-dot', '/sites/S/views/.\t./workbooks'],
      ['trailing space after dot-dot', '/sites/S/views/.. '],
      ['literal query', `/sites/S/views/${LUID}?x=/data`],
      ['literal fragment', `/sites/S/views/${LUID}#/data`],
      ['absolute URL', 'https://evil.test/sites/S'],
      ['protocol-relative URL', '//evil.test/sites/S'],
      ['relative path without leading slash', 'sites/S'],
      ['non-ASCII', '/sites/S/views/é'],
      ['empty', ''],
      ['literal semicolon (Tomcat path param)', `/sites/S/views/${LUID};x/data`],
      ['empty segment', '/sites/s//views'],
      ['trailing empty segment', '/sites/s/views//'],
    ])('rejects %s', (_n, url) => {
      expect(() => assertSafeRequestUrl(url, BASE)).toThrow(RouteSafetyError);
    });

    it('accepts the OAuth token endpoint under its base path', () => {
      expect(() => assertSafeRequestUrl('/oauth2/v1/token', 'https://sso.test')).not.toThrow();
    });

    it('rejects a missing URL or base URL', () => {
      expect(() => assertSafeRequestUrl(undefined, BASE)).toThrow(RouteSafetyError);
      expect(() => assertSafeRequestUrl(`/sites/${LUID}`, undefined)).toThrow(RouteSafetyError);
    });

    it.each([
      `/sites/${LUID}/views/${LUID}/image`,
      '/sites/S/pulse/definitions%3AbatchGet',
      '/sites/S/files/a.b',
      '/sites/S/knowledge/nodes/field%3AProfit%20%25',
      '/sites/S/fileUploads/12345:ABCDEF0123-4:5',
      `/sites/${LUID}/workbooks`,
      '/sites/S/knowledge/nodes/x%3By',
    ])('accepts %s', (url) => {
      expect(() => assertSafeRequestUrl(url, BASE)).not.toThrow();
      expect(() => assertSafeRequestUrl(url, `${BASE}/`)).not.toThrow();
    });
  });

  describe('buildRestPath', () => {
    it('encodes and joins segments', () => {
      expect(buildRestPath('sites', 's1', 'views', LUID, 'data')).toBe(
        `/sites/s1/views/${LUID}/data`,
      );
    });

    it('encodes decoded segments exactly once, keeping `:` literal', () => {
      expect(buildRestPath('sites', 's1', 'pulse', 'definitions:batchGet', 'Profit %')).toBe(
        '/sites/s1/pulse/definitions:batchGet/Profit%20%25',
      );
    });

    it('keeps the `:` of a Tableau upload session ID literal, as before this guard', () => {
      expect(buildRestPath('sites', 's1', 'fileUploads', '12345:ABCDEF0123-4:5')).toBe(
        '/sites/s1/fileUploads/12345:ABCDEF0123-4:5',
      );
    });

    it('rejects pre-encoded segments instead of double-encoding them, naming the segment', () => {
      expect(() => buildRestPath('sites', 's1', 'definitions%3AbatchGet')).toThrow(
        "buildRestPath expects decoded path segments, not percent-encoded ones ('segment 2')",
      );
    });

    it('names the offending segment by index', () => {
      expect(() => buildRestPath('sites', 's1', 'views', '..', 'data')).toThrow(
        "Path parameter 'segment 3' is not a valid route segment",
      );
    });

    it('wraps the URIError for a lone surrogate in a RouteSafetyError', () => {
      expect(() => buildRestPath('sites', 's1', 'views', '\uD800')).toThrow(
        new RouteSafetyError("Path parameter 'segment 3' is not a valid route segment"),
      );
    });

    it('treats a non-escape % as a literal and encodes it', () => {
      expect(buildRestPath('sites', 's1', '%zz')).toBe('/sites/s1/%25zz');
    });

    it.each([
      ['dot-dot slash', '../x'],
      ['dot-dot', '..'],
      ['dot', '.'],
      ['backslash', '..\\x'],
      ['report payload', '../workbooks/W1/content?includeExtract=true&x='],
      ['slash', 'Profit/Sales'],
      // Encoded, these are still a dot segment / control character once the server decodes them.
      ['dot-dot with trailing space', '.. '],
      ['dot-dot split by a tab', '.\t.'],
      ['tab', 'a\tb'],
    ])('rejects %s', (_n, payload) => {
      expect(() => buildRestPath('sites', 's1', payload)).toThrow(RouteSafetyError);
    });

    // Raw `?`, `#`, `;` and spaces are harmless once encoded.
    it.each(['a?b', 'a#b', 'a;b', 'a b'])('encodes %j safely', (v) => {
      const path = buildRestPath('sites', 's1', v);
      expect(path).toBe(`/sites/s1/${encodeURIComponent(v)}`);
      expect(() => assertSafeRequestUrl(path, BASE)).not.toThrow();
    });
  });

  describe('luidSchema', () => {
    it.each([LUID, 'ABCDEF01-2345-6789-abcd-ef0123456789'])('accepts %s', (v) => {
      expect(luidSchema.parse(v)).toBe(v);
    });

    it.each([...attacks.map(([, p]) => p), 'view-123', '1', '..'.padEnd(36, 'x')])(
      'rejects %j with a Zod issue (not a throw)',
      (v) => {
        const result = luidSchema.safeParse(v);
        expect(result.success).toBe(false);
        expect(result.error?.issues[0].message).toBe('must be a Tableau LUID (UUID format)');
      },
    );
  });

  describe('pathParamGuardPlugin', () => {
    const run = (params: Record<string, unknown>): Promise<unknown> =>
      pathParamGuardPlugin.request!({} as never, { params } as never);

    it('passes safe params through', async () => {
      await expect(run({ siteId: LUID, viewId: LUID })).resolves.toBeDefined();
    });

    it('throws on unsafe params', async () => {
      await expect(run({ viewId: '../x' })).rejects.toThrow(RouteSafetyError);
    });
  });
});
