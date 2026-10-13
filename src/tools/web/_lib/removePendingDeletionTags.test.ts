import { Err, Ok } from 'ts-results-es';
import type { MockedFunction } from 'vitest';

import * as logger from '../../../logging/logger.js';
import type { RestApi } from '../../../sdks/tableau/restApi.js';
import invariant from '../../../utils/invariant.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { auditRecordSchema } from './auditRecord.js';
import {
  removePendingDeletionTags,
  RemovePendingDeletionTagsResult,
} from './removePendingDeletionTags.js';

vi.mock('../../../logging/logger.js');

const mocks = vi.hoisted(() => ({
  mockGetWorkbook: vi.fn(),
  mockDeleteTagFromWorkbook: vi.fn(),
  mockQueryDatasource: vi.fn(),
  mockDeleteTagFromDatasource: vi.fn(),
  mockAssertAdmin: vi.fn(),
  mockIsWorkbookAllowed: vi.fn(),
  mockIsDatasourceAllowed: vi.fn(),
}));

vi.mock('../adminGate.js', () => ({
  assertAdmin: mocks.mockAssertAdmin,
}));

vi.mock('../resourceAccessChecker.js', () => ({
  resourceAccessChecker: {
    isWorkbookAllowed: mocks.mockIsWorkbookAllowed,
    isDatasourceAllowed: mocks.mockIsDatasourceAllowed,
  },
}));

vi.mock('../../../config.js', () => ({
  getConfig: vi.fn(() => ({
    adminToolsEnabled: true,
    productTelemetryEnabled: false,
    productTelemetryEndpoint: 'https://test.com',
    server: 'https://test.tableau.com',
  })),
}));

function getAuditRecords(): ReturnType<typeof auditRecordSchema.parse>[] {
  const log = logger.log as MockedFunction<typeof logger.log>;
  return log.mock.calls
    .map((c) => c[0])
    .filter((e) => e.logger === 'audit')
    .map((e) => auditRecordSchema.parse(e.data));
}

function workbookWithTags(...labels: string[]): Record<string, unknown> {
  return {
    id: 'wb-1',
    name: 'Old Sales',
    project: { name: 'Finance' },
    tags: { tag: labels.map((label) => ({ label })) },
  };
}

describe('removePendingDeletionTags helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockAssertAdmin.mockResolvedValue(new Ok(true));
    mocks.mockIsWorkbookAllowed.mockResolvedValue({ allowed: true });
    mocks.mockIsDatasourceAllowed.mockResolvedValue({ allowed: true });
    mocks.mockDeleteTagFromWorkbook.mockResolvedValue(undefined);
    mocks.mockDeleteTagFromDatasource.mockResolvedValue(undefined);
  });

  it('removes every pending-deletion marker (dated and legacy) and nothing else', async () => {
    mocks.mockGetWorkbook.mockResolvedValue(
      workbookWithTags(
        'finance',
        'pending-deletion-2026-09-01',
        'pending-deletion',
        'pending-deletion-notes',
      ),
    );
    const result = await callTool({ resourceType: 'workbook', resourceIds: ['wb-1'] });
    expect(result.removedCount).toBe(2);
    expect(result.items).toEqual([
      {
        resourceId: 'wb-1',
        status: 'removed',
        removedTags: ['pending-deletion-2026-09-01', 'pending-deletion'],
      },
    ]);
    const removed = mocks.mockDeleteTagFromWorkbook.mock.calls.map((c) => c[0].tagLabel);
    expect(removed).toEqual(['pending-deletion-2026-09-01', 'pending-deletion']);
    expect(removed).not.toContain('finance');
    expect(removed).not.toContain('pending-deletion-notes');
  });

  it('removes only the named batch when cleanupDate is given', async () => {
    mocks.mockQueryDatasource.mockResolvedValue({
      name: 'Extract',
      tags: {
        tag: [{ label: 'pending-deletion-2026-09-01' }, { label: 'pending-deletion-2026-09-25' }],
      },
    });
    const result = await callTool({
      resourceType: 'datasource',
      resourceIds: ['ds-1'],
      cleanupDate: '2026-09-25',
    });
    expect(result.items[0].removedTags).toEqual(['pending-deletion-2026-09-25']);
    expect(mocks.mockDeleteTagFromDatasource).toHaveBeenCalledExactlyOnceWith({
      datasourceId: 'ds-1',
      siteId: 'test-site-id',
      tagLabel: 'pending-deletion-2026-09-25',
    });
  });

  it('reports no-markers (and makes no REST write) when the item has none', async () => {
    mocks.mockGetWorkbook.mockResolvedValue(workbookWithTags('finance'));
    const result = await callTool({ resourceType: 'workbook', resourceIds: ['wb-1'] });
    expect(result.items[0].status).toBe('no-markers');
    expect(result.removedCount).toBe(0);
    expect(mocks.mockDeleteTagFromWorkbook).not.toHaveBeenCalled();
  });

  it('audits each item as an update', async () => {
    mocks.mockGetWorkbook.mockResolvedValue(workbookWithTags('pending-deletion-2026-09-01'));
    await callTool({ resourceType: 'workbook', resourceIds: ['wb-1'] });
    const records = getAuditRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      tool: 'delete-content',
      action: 'update',
      result: 'completed',
    });
    expect(records[0].target.name).toBe('Old Sales');
  });

  it('dedupes resourceIds', async () => {
    mocks.mockGetWorkbook.mockResolvedValue(workbookWithTags('pending-deletion'));
    const result = await callTool({ resourceType: 'workbook', resourceIds: ['wb-1', 'wb-1'] });
    expect(result.items).toHaveLength(1);
    expect(mocks.mockGetWorkbook).toHaveBeenCalledTimes(1);
  });

  it('skips items outside the bounded context without reading or writing them', async () => {
    mocks.mockIsWorkbookAllowed.mockResolvedValue({ allowed: false, message: 'not allowed' });
    const result = await callTool({ resourceType: 'workbook', resourceIds: ['wb-1'] });
    expect(result.items[0]).toMatchObject({ status: 'not-allowed', message: 'not allowed' });
    expect(mocks.mockGetWorkbook).not.toHaveBeenCalled();
    expect(mocks.mockDeleteTagFromWorkbook).not.toHaveBeenCalled();
  });

  it('reports a per-item error and continues with the rest of the batch', async () => {
    mocks.mockGetWorkbook
      .mockRejectedValueOnce(new Error('404 not found'))
      .mockResolvedValueOnce(workbookWithTags('pending-deletion'));
    const result = await callTool({ resourceType: 'workbook', resourceIds: ['gone', 'wb-1'] });
    expect(result.items.map((i) => i.status)).toEqual(['error', 'removed']);
    expect(result.items[0].message).toContain('404');
  });

  it('records a failed outcome when a tag delete fails', async () => {
    mocks.mockGetWorkbook.mockResolvedValue(workbookWithTags('pending-deletion'));
    mocks.mockDeleteTagFromWorkbook.mockRejectedValue(new Error('500 boom'));
    const result = await callTool({ resourceType: 'workbook', resourceIds: ['wb-1'] });
    expect(result.items[0]).toMatchObject({ status: 'error', removedTags: [] });
    expect(getAuditRecords().map((r) => r.result)).toEqual(['failed']);
  });

  it('denies non-admins before reading any item', async () => {
    mocks.mockAssertAdmin.mockResolvedValue(new Err('User is not a site administrator'));
    const raw = await run({ resourceType: 'workbook', resourceIds: ['wb-1'] });
    expect(raw.isErr()).toBe(true);
    expect(raw.unwrapErr().message).toContain('site administrator');
    expect(mocks.mockIsWorkbookAllowed).not.toHaveBeenCalled();
    expect(mocks.mockGetWorkbook).not.toHaveBeenCalled();
    expect(mocks.mockDeleteTagFromWorkbook).not.toHaveBeenCalled();
  });
});

type Args = {
  resourceType: 'workbook' | 'datasource';
  resourceIds: string[];
  cleanupDate?: string;
};

const restApi = {
  workbooksMethods: {
    getWorkbook: mocks.mockGetWorkbook,
    deleteTagFromWorkbook: mocks.mockDeleteTagFromWorkbook,
  },
  datasourcesMethods: {
    queryDatasource: mocks.mockQueryDatasource,
    deleteTagFromDatasource: mocks.mockDeleteTagFromDatasource,
  },
  siteId: 'test-site-id',
} as unknown as RestApi;

async function run(args: Args): ReturnType<typeof removePendingDeletionTags> {
  return await removePendingDeletionTags({
    restApi,
    extra: getMockRequestHandlerExtra(),
    cleanupDate: undefined,
    ...args,
  });
}

async function callTool(args: Args): Promise<RemovePendingDeletionTagsResult> {
  const result = await run(args);
  invariant(result.isOk(), `expected success: ${JSON.stringify(result)}`);
  return result.value;
}
