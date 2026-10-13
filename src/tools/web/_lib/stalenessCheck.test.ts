import { Err, Ok } from 'ts-results-es';

import { AdminInsightsUnavailableError } from '../../../errors/mcpToolError.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { executeAdminInsightsQuery } from '../adminInsights/adminInsightsToolBase.js';
import { checkContentStillStale } from './stalenessCheck.js';

vi.mock('../adminInsights/adminInsightsToolBase.js', () => ({
  executeAdminInsightsQuery: vi.fn(),
}));
const mockQuery = vi.mocked(executeAdminInsightsQuery);

const restApi = { siteId: 'site-1' } as unknown as RestApi;
const NOW = new Date('2026-09-25T12:00:00Z');
const BATCH = '2026-09-25';

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'Item ID': '101',
    'Item LUID': 'wb-1',
    'Item Type': 'Workbook',
    'Item Name': 'Old Sales',
    'Item Parent Project Name': 'Finance',
    'Created At': '2025-01-01T00:00:00Z',
    'Last Accessed At': '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

function respondWith(rows: Array<Record<string, unknown>>): void {
  mockQuery.mockResolvedValue(new Ok({ data: rows }) as never);
}

async function check(
  overrides: Partial<Parameters<typeof checkContentStillStale>[0]> = {},
): ReturnType<typeof checkContentStillStale> {
  return await checkContentStillStale({
    restApi,
    resourceType: 'workbook',
    resourceId: 'wb-1',
    minAgeDays: 90,
    cleanupDate: BATCH,
    now: NOW,
    ...overrides,
  });
}

describe('checkContentStillStale', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes when the item is still stale and untouched since the batch date', async () => {
    respondWith([row()]);
    const result = await check();
    expect(result.isOk()).toBe(true);
  });

  it('queries Site Content for exactly this item by type and LUID', async () => {
    respondWith([row({ 'Item Type': 'Datasource', 'Item LUID': 'ds-1' })]);
    await check({ resourceType: 'datasource', resourceId: 'ds-1' });
    const { query } = mockQuery.mock.calls[0][0];
    expect(query.filters).toEqual([
      expect.objectContaining({ field: { fieldCaption: 'Item Type' }, values: ['Datasource'] }),
      expect.objectContaining({ field: { fieldCaption: 'Item LUID' }, values: ['ds-1'] }),
    ]);
  });

  it('blocks content used within the threshold (content-not-stale)', async () => {
    respondWith([row({ 'Last Accessed At': '2026-08-01T00:00:00Z' })]);
    const result = await check();
    expect(result.isErr()).toBe(true);
    const error = result.unwrapErr();
    expect(error.type).toBe('content-not-stale');
    expect(error.message).toContain('last used 2026-08-01');
    expect(error.message).toContain('threshold 90 days');
    expect(error.message).toContain('remove-pending-tags');
  });

  it('respects a larger minAgeDays threshold', async () => {
    // 208 days since 2026-03-01: stale at 90, not stale at 365.
    respondWith([row()]);
    expect((await check({ minAgeDays: 365 })).unwrapErr().type).toBe('content-not-stale');
  });

  it('falls back to Created At for never-accessed content', async () => {
    respondWith([row({ 'Last Accessed At': null, 'Created At': '2026-09-01T00:00:00Z' })]);
    expect((await check()).unwrapErr().type).toBe('content-not-stale');

    respondWith([row({ 'Last Accessed At': null, 'Created At': '2025-01-01T00:00:00Z' })]);
    expect((await check()).isOk()).toBe(true);
  });

  it('blocks content accessed on or after the cleanup batch date even if still past threshold', async () => {
    // Batch from long ago, access after it: still "stale" by the threshold, but the batch's
    // assessment predates that use.
    respondWith([row({ 'Last Accessed At': '2026-03-01T00:00:00Z' })]);
    const result = await check({ cleanupDate: '2026-02-15', minAgeDays: 30 });
    const error = result.unwrapErr();
    expect(error.type).toBe('content-not-stale');
    expect(error.message).toContain('accessed on 2026-03-01');
    expect(error.message).toContain('cleanup batch date 2026-02-15');
  });

  it('allows access strictly before the batch date', async () => {
    respondWith([row({ 'Last Accessed At': '2026-02-14T23:59:59Z' })]);
    expect((await check({ cleanupDate: '2026-02-15', minAgeDays: 30 })).isOk()).toBe(true);
  });

  it('treats an offset-less access timestamp as UTC', async () => {
    // 23:30 UTC the day before the batch: before the batch regardless of host time zone.
    respondWith([row({ 'Last Accessed At': '2026-02-14T23:30:00' })]);
    expect((await check({ cleanupDate: '2026-02-15', minAgeDays: 30 })).isOk()).toBe(true);
    respondWith([row({ 'Last Accessed At': '2026-02-15T00:30:00' })]);
    expect((await check({ cleanupDate: '2026-02-15', minAgeDays: 30 })).unwrapErr().type).toBe(
      'content-not-stale',
    );
  });

  it('fails closed as unverified (not "recently used") when the row is incomplete', async () => {
    respondWith([row({ 'Item ID': null })]);
    const error = (await check()).unwrapErr();
    expect(error.type).toBe('staleness-unverified');
    expect(error.message).toContain('incomplete');
  });

  it('fails closed (staleness-unverified) when Admin Insights cannot be queried', async () => {
    mockQuery.mockResolvedValue(
      new Err(new AdminInsightsUnavailableError('Admin Insights is not available')) as never,
    );
    const error = (await check()).unwrapErr();
    expect(error.type).toBe('staleness-unverified');
    expect(error.message).toContain('Admin Insights is not available');
    expect(error.message).toContain('Tableau Cloud');
  });

  it('fails closed when the item is absent from Site Content', async () => {
    respondWith([]);
    const error = (await check()).unwrapErr();
    expect(error.type).toBe('staleness-unverified');
    expect(error.message).toContain('not found in Admin Insights Site Content');
  });

  it('ignores rows for other items the server may return', async () => {
    respondWith([row({ 'Item LUID': 'someone-else' })]);
    expect((await check()).unwrapErr().type).toBe('staleness-unverified');
  });

  it('requires EVERY matching row to qualify', async () => {
    respondWith([row(), row({ 'Item ID': '102', 'Last Accessed At': '2026-09-20T00:00:00Z' })]);
    expect((await check()).unwrapErr().type).toBe('content-not-stale');
  });
});
