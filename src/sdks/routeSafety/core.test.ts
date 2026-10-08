import { z } from 'zod';

import {
  assertNoTraversal,
  assertSafePathSegment,
  buildRestPath,
  fullyDecode,
  luidSchema,
  pathParamGuardPlugin,
  RouteSafetyError,
} from './index.js';

const LUID = '11111111-1111-1111-1111-111111111111';

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
];

describe('routeSafety', () => {
  describe('assertSafePathSegment', () => {
    it.each(attacks)('rejects %s', (_n, payload) => {
      expect(() => assertSafePathSegment('p', payload)).toThrow(RouteSafetyError);
    });

    it('rejects non-string values', () => {
      expect(() => assertSafePathSegment('p', undefined)).toThrow(RouteSafetyError);
      expect(() => assertSafePathSegment('p', {})).toThrow(RouteSafetyError);
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
    ])('accepts %s', (v) => {
      expect(assertSafePathSegment('p', v)).toBe(v);
    });
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

  describe('assertNoTraversal', () => {
    it.each([
      '/sites/S/views/../workbooks/W/content',
      '/sites/S/views/%2e%2e/workbooks',
      '/sites/S/views/.%2E/x',
      '/sites/S/views/..\\x',
      '/sites/S/views/%252e%252e/x',
      '/sites/S/views/%zz/x',
      '/sites/S/views/..;/workbooks',
      '/sites/S/views/..;jsessionid=x/workbooks',
      '/sites/S/views/%2e%2e%3b/workbooks',
    ])('rejects %s', (url) => {
      expect(() => assertNoTraversal(url)).toThrow(RouteSafetyError);
    });

    it.each([
      `/sites/S/views/${LUID}/image?x=../y`,
      '/sites/S/pulse/definitions%3AbatchGet',
      '/sites/S/files/a.b',
      '/sites/S/knowledge/nodes/field%3AProfit%20%25',
    ])('accepts %s', (url) => {
      expect(() => assertNoTraversal(url)).not.toThrow();
    });
  });

  describe('buildRestPath', () => {
    it('encodes and joins segments', () => {
      expect(buildRestPath('sites', 's1', 'views', LUID, 'data')).toBe(
        `/sites/s1/views/${LUID}/data`,
      );
    });

    it('encodes decoded segments exactly once', () => {
      expect(buildRestPath('sites', 's1', 'pulse', 'definitions:batchGet', 'Profit %')).toBe(
        '/sites/s1/pulse/definitions%3AbatchGet/Profit%20%25',
      );
    });

    it('rejects pre-encoded segments instead of double-encoding them', () => {
      expect(() => buildRestPath('sites', 's1', 'definitions%3AbatchGet')).toThrow(
        'expects decoded path segments',
      );
    });

    it('treats a non-escape % as a literal and encodes it', () => {
      expect(buildRestPath('sites', 's1', '%zz')).toBe('/sites/s1/%25zz');
    });

    // `%zz` is not an escape, so under the decoded-segment contract it is a harmless literal.
    it.each(attacks.filter(([, p]) => p !== '%zz'))('rejects %s', (_n, payload) => {
      expect(() => buildRestPath('sites', 's1', payload)).toThrow(RouteSafetyError);
    });
  });

  describe('luidSchema', () => {
    it('accepts a LUID', () => {
      expect(luidSchema.parse(LUID)).toBe(LUID);
    });

    it.each([...attacks.map(([, p]) => p), 'view-123', '1', '..'.padEnd(36, 'x')])(
      'rejects %j',
      (v) => {
        expect(z.string().uuid().safeParse(v).success).toBe(false);
        expect(luidSchema.safeParse(v).success).toBe(false);
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
