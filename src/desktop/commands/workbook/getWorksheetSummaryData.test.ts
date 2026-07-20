import { Err, Ok } from 'ts-results-es';

import invariant from '../../../utils/invariant.js';
import { ExecuteCommandError } from '../../toolExecutor/toolExecutor.js';
import { fakeExternalReadsExecutor } from './externalReadsMock.js';
import { getWorksheetSummaryData } from './getWorksheetSummaryData.js';

describe('getWorksheetSummaryData', () => {
  const mockSignal = new AbortController().signal;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves the name to an id and returns the summary data', async () => {
    const getSummary = vi.fn().mockResolvedValue(
      Ok({
        columns: [{ name: 'Category', dataType: 'string' }],
        rows: [['Furniture'], ['Technology']],
      }),
    );
    const executor = fakeExternalReadsExecutor({
      listWorksheets: () =>
        Promise.resolve(Ok({ worksheets: [{ id: 'w1', name: 'Sales', hidden: false }] })),
      getWorksheetSummaryData: getSummary,
    });

    const result = await getWorksheetSummaryData({
      worksheetName: 'Sales',
      executor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.rows).toEqual([['Furniture'], ['Technology']]);
    }
    expect(getSummary).toHaveBeenCalledWith('w1', { maxRows: undefined }, mockSignal);
  });

  it('forwards maxRows when provided', async () => {
    const getSummary = vi.fn().mockResolvedValue(Ok({ rows: [] }));
    const executor = fakeExternalReadsExecutor({
      listWorksheets: () =>
        Promise.resolve(Ok({ worksheets: [{ id: 'w1', name: 'Sales', hidden: false }] })),
      getWorksheetSummaryData: getSummary,
    });

    await getWorksheetSummaryData({
      worksheetName: 'Sales',
      maxRows: 100,
      executor,
      signal: mockSignal,
    });

    expect(getSummary).toHaveBeenCalledWith('w1', { maxRows: 100 }, mockSignal);
  });

  it('returns no-worksheet-found when the name does not match', async () => {
    const executor = fakeExternalReadsExecutor({
      listWorksheets: () =>
        Promise.resolve(Ok({ worksheets: [{ id: 'w9', name: 'Other', hidden: false }] })),
    });

    const result = await getWorksheetSummaryData({
      worksheetName: 'Sales',
      executor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'get-worksheet-summary-data-error');
      expect(result.error.error.type).toBe('no-worksheet-found');
      expect(result.error.error.message).toContain('Sales');
    }
  });

  it('returns execute-command-error when the list call fails', async () => {
    const error: ExecuteCommandError = {
      type: 'command-failed',
      error: { code: 'ERROR', message: 'Failed', recoverable: false },
    };
    const executor = fakeExternalReadsExecutor({
      listWorksheets: () => Promise.resolve(Err(error)),
    });

    const result = await getWorksheetSummaryData({
      worksheetName: 'Sales',
      executor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'execute-command-error');
      expect(result.error.error).toEqual(error);
    }
  });
});
