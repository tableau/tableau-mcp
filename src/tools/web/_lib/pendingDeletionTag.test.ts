import {
  checkCleanupBatchAge,
  cleanupDateSchema,
  formatPendingDeletionTag,
  getCleanupBatchAgeDays,
  getPendingDeletionMarkers,
  getUtcCleanupDate,
  isValidCleanupDate,
  parsePendingDeletionTag,
} from './pendingDeletionTag.js';

describe('pendingDeletionTag', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getUtcCleanupDate', () => {
    it('formats the UTC calendar date with no time suffix', () => {
      expect(getUtcCleanupDate(new Date('2026-09-25T13:45:00Z'))).toBe('2026-09-25');
    });

    it('uses the UTC date, not the local date, near midnight', () => {
      // 23:30 at UTC-07:00 on Sept 24 is already Sept 25 in UTC.
      expect(getUtcCleanupDate(new Date('2026-09-24T23:30:00-07:00'))).toBe('2026-09-25');
    });
  });

  describe('formatPendingDeletionTag', () => {
    it('produces the exact pending-deletion-yyyy-mm-dd format', () => {
      expect(formatPendingDeletionTag('2026-09-25')).toBe('pending-deletion-2026-09-25');
    });
  });

  describe('isValidCleanupDate', () => {
    it.each(['2026-09-25', '2024-02-29'])('accepts %s', (value) => {
      expect(isValidCleanupDate(value)).toBe(true);
    });

    it.each(['2026-9-25', '2026-02-30', '2026-13-01', '20260925', '2026-09-25T00:00:00Z', ''])(
      'rejects %s',
      (value) => {
        expect(isValidCleanupDate(value)).toBe(false);
      },
    );
  });

  describe('parsePendingDeletionTag', () => {
    it('parses a dated marker', () => {
      expect(parsePendingDeletionTag('pending-deletion-2026-09-25')).toEqual({
        tag: 'pending-deletion-2026-09-25',
        kind: 'dated',
        cleanupDate: '2026-09-25',
      });
    });

    it('parses the undated legacy marker', () => {
      expect(parsePendingDeletionTag('pending-deletion')).toEqual({
        tag: 'pending-deletion',
        kind: 'legacy',
        cleanupDate: null,
      });
    });

    it.each([
      'pending-deletion-2026-13-01',
      'pending-deletion-2026-09-25-1200',
      'stale-pending-deletion',
      'Pending-Deletion-2026-09-25',
      'finance',
    ])('does not treat %s as a marker', (label) => {
      expect(parsePendingDeletionTag(label)).toBeNull();
    });
  });

  describe('getPendingDeletionMarkers', () => {
    it('returns only marker tags', () => {
      const markers = getPendingDeletionMarkers({
        tag: [
          { label: 'finance' },
          { label: 'pending-deletion' },
          { label: 'pending-deletion-2026-08-01' },
        ],
      });
      expect(markers.map((m) => m.tag)).toEqual([
        'pending-deletion',
        'pending-deletion-2026-08-01',
      ]);
    });

    it('handles missing tags', () => {
      expect(getPendingDeletionMarkers(undefined)).toEqual([]);
      expect(getPendingDeletionMarkers({})).toEqual([]);
    });
  });

  describe('cleanupDateSchema', () => {
    it('accepts today and past dates', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-25T10:00:00Z'));
      expect(cleanupDateSchema.safeParse('2026-09-25').success).toBe(true);
      expect(cleanupDateSchema.safeParse('2026-08-01').success).toBe(true);
    });

    it('rejects future dates', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-25T10:00:00Z'));
      const result = cleanupDateSchema.safeParse('2026-09-26');
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toContain('must not be in the future');
    });

    it('rejects malformed dates', () => {
      expect(cleanupDateSchema.safeParse('09/25/2026').success).toBe(false);
    });
  });

  describe('getCleanupBatchAgeDays', () => {
    const now = new Date('2026-09-25T23:59:00Z');

    it('counts whole UTC calendar days, 0 for today', () => {
      expect(getCleanupBatchAgeDays('2026-09-25', now)).toBe(0);
      expect(getCleanupBatchAgeDays('2026-09-24', now)).toBe(1);
      expect(getCleanupBatchAgeDays('2026-08-26', now)).toBe(30);
    });

    it('is not affected by the time of day or a DST transition in between', () => {
      expect(getCleanupBatchAgeDays('2026-03-01', new Date('2026-04-01T00:00:01Z'))).toBe(31);
      expect(getCleanupBatchAgeDays('2026-03-01', new Date('2026-04-01T23:59:59Z'))).toBe(31);
    });
  });

  describe('checkCleanupBatchAge', () => {
    const now = new Date('2026-09-25T12:00:00Z');

    it('accepts a batch opened today', () => {
      expect(checkCleanupBatchAge({ cleanupDate: '2026-09-25', maxAgeDays: 30, now })).toBeNull();
    });

    it('accepts a batch exactly maxAgeDays old (inclusive bound)', () => {
      expect(checkCleanupBatchAge({ cleanupDate: '2026-08-26', maxAgeDays: 30, now })).toBeNull();
    });

    it('rejects a batch one day past the limit as cleanup-batch-expired', () => {
      const error = checkCleanupBatchAge({ cleanupDate: '2026-08-25', maxAgeDays: 30, now });
      expect(error?.type).toBe('cleanup-batch-expired');
      expect(error?.statusCode).toBe(409);
      expect(error?.message).toContain('31 days old, past the 30-day limit');
      expect(error?.message).toContain('pending-deletion-2026-08-25');
      expect(error?.message).toContain('Nothing was deleted');
      expect(error?.message).toContain('remove-pending-tags');
    });

    it('honors a tighter limit', () => {
      expect(checkCleanupBatchAge({ cleanupDate: '2026-09-24', maxAgeDays: 1, now })).toBeNull();
      expect(checkCleanupBatchAge({ cleanupDate: '2026-09-23', maxAgeDays: 1, now })?.type).toBe(
        'cleanup-batch-expired',
      );
    });
  });
});
