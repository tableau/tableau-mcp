import { z } from 'zod';

import {
  assertNoTraversal,
  assertSafePathSegment,
  buildRestPath,
  luidSchema,
  pathParamGuardPlugin,
  RouteSafetyError,
} from './routeSafety';

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

    it.each([LUID, 'exp', 'definitions%3AbatchGet', 'a%3Ab', 'field%3AProfit%20Ratio', 'my-site'])(
      'accepts %s',
      (v) => {
        expect(assertSafePathSegment('p', v)).toBe(v);
      },
    );
  });

  describe('assertNoTraversal', () => {
    it.each([
      '/sites/S/views/../workbooks/W/content',
      '/sites/S/views/%2e%2e/workbooks',
      '/sites/S/views/.%2E/x',
      '/sites/S/views/..\\x',
      '/sites/S/views/%252e%252e/x',
      '/sites/S/views/%zz/x',
    ])('rejects %s', (url) => {
      expect(() => assertNoTraversal(url)).toThrow(RouteSafetyError);
    });

    it.each([
      `/sites/S/views/${LUID}/image?x=../y`,
      '/sites/S/pulse/definitions%3AbatchGet',
      '/sites/S/files/a.b',
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

    it.each(attacks)('rejects %s', (_n, payload) => {
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
