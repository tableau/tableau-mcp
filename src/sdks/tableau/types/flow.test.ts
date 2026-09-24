import { flowRunSchema } from './flow.js';

describe('flowRunSchema', () => {
  const baseRun = {
    id: 'a1111111-1111-1111-1111-111111111111',
    flowId: 'd00700fe-28a0-4ece-a7af-5543ddf38a82',
    status: 'Failed',
    startedAt: '2025-06-05T10:00:00Z',
    completedAt: '2025-06-05T10:01:00Z',
  };

  describe('failureReason', () => {
    it('is omitted when the server does not return it', () => {
      const run = flowRunSchema.parse(baseRun);
      expect(run.failureReason).toBeUndefined();
    });

    it('parses a resolved reason', () => {
      const run = flowRunSchema.parse({
        ...baseRun,
        failureReason: { available: true, message: 'Table "orders" was not found.' },
      });

      expect(run.failureReason).toEqual({
        available: true,
        message: 'Table "orders" was not found.',
      });
    });

    it('parses an unresolved reason', () => {
      const run = flowRunSchema.parse({
        ...baseRun,
        failureReason: { available: false, message: 'Error in flow steps' },
      });

      expect(run.failureReason).toEqual({ available: false, message: 'Error in flow steps' });
    });

    // Tableau serializes XML attributes as strings, so `available` can arrive as
    // "true"/"false" rather than as a real boolean.
    it.each([
      ['"true"', 'true', true],
      ['"false"', 'false', false],
      ['" False "', ' False ', false],
    ])('reads a string %s as %s', (_label, available, expected) => {
      const run = flowRunSchema.parse({
        ...baseRun,
        failureReason: { available, message: 'Error in flow steps' },
      });

      expect(run.failureReason?.available).toBe(expected);
    });

    // Resolving to `false` (not `undefined`) is what keeps the caller on the UI
    // fallback path instead of asserting a cause it cannot support.
    it.each([
      ['junk', 'perhaps'],
      ['null', null],
      ['absent', undefined],
    ])('resolves %s availability to false, never undefined', (_label, available) => {
      const run = flowRunSchema.parse({
        ...baseRun,
        failureReason: { available, message: 'Error in flow steps' },
      });

      expect(run.failureReason?.available).toBe(false);
    });

    // A malformed reason must not fail the whole Get Flow Runs response — this is
    // a Zodios response schema, so throwing here would lose every run in the
    // window over one bad sidecar field. Degrading to absent puts the caller on
    // the UI-deep-link fallback, which is the intended no-reason behavior.
    it.each([
      ['no message', { available: true }],
      ['a non-string message', { available: true, message: 42 }],
      ['a non-object reason', 'Error in flow steps'],
    ])('drops a reason with %s rather than failing the run', (_label, failureReason) => {
      const run = flowRunSchema.parse({ ...baseRun, failureReason });

      expect(run.failureReason).toBeUndefined();
      expect(run.id).toBe(baseRun.id);
    });
  });
});
