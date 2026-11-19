import { workbookRevisionSchema } from './workbookRevision.js';

describe('workbook revision response', () => {
  it('preserves deleted authors, markers and numeric-string revision numbers', () => {
    expect(
      workbookRevisionSchema.parse({ revisionNumber: '2', isCurrent: 'false', isDeleted: 'true' }),
    ).toEqual({ revisionNumber: 2, isCurrent: false, isDeleted: true });
  });
  it('keeps absent markers absent and strips undocumented response fields', () => {
    expect(workbookRevisionSchema.parse({ revisionNumber: 3, private: 'hidden' })).toEqual({
      revisionNumber: 3,
    });
  });
  it.each([0, -1, 1.5, 'no', Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid revision %s',
    (revisionNumber) => {
      expect(workbookRevisionSchema.safeParse({ revisionNumber }).success).toBe(false);
    },
  );
});
