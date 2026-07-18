import { Err, Ok } from 'ts-results-es';

import invariant from '../../../utils/invariant.js';
import { LocalExecutor } from '../../toolExecutor/localToolExecutor.js';
import { getWorksheetSummaryData } from './getWorksheetSummaryData.js';

vi.mock('../../toolExecutor/localToolExecutor.js');

describe('getWorksheetSummaryData', () => {
  const mockSignal = new AbortController().signal;

  function executorFor(
    worksheets: Array<{ id: string; name: string }>,
    summaryById: Record<string, { columns?: unknown; rows?: unknown }> = {},
  ): LocalExecutor {
    return {
      executeCommand: vi.fn().mockImplementation((params) => {
        if (params.command === 'list-worksheets') {
          return Promise.resolve(
            Ok({ command_id: 'cmd-1', status: 'completed', parsedResult: { worksheets } }),
          );
        }
        if (params.command === 'get-worksheet-summary-data') {
          return Promise.resolve(
            Ok({
              command_id: 'cmd-2',
              status: 'completed',
              parsedResult: summaryById[params.args.id] ?? {},
            }),
          );
        }
        return Promise.resolve(Err({ type: 'command-failed', error: { code: 'x', message: 'x' } }));
      }),
    } as unknown as LocalExecutor;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves the name to an id and returns the summary data', async () => {
    const mockExecutor = executorFor([{ id: 'w1', name: 'Sales' }], {
      w1: {
        columns: [{ name: 'Category', dataType: 'string' }],
        rows: [['Furniture'], ['Technology']],
      },
    });

    const result = await getWorksheetSummaryData({
      worksheetName: 'Sales',
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.rows).toEqual([['Furniture'], ['Technology']]);
    }

    expect(mockExecutor.executeCommand).toHaveBeenCalledWith({
      namespace: 'tabui',
      command: 'get-worksheet-summary-data',
      args: { id: 'w1' },
      schema: expect.any(Object),
      signal: mockSignal,
    });
  });

  it('forwards maxRows when provided', async () => {
    const mockExecutor = executorFor([{ id: 'w1', name: 'Sales' }], { w1: { rows: [] } });

    await getWorksheetSummaryData({
      worksheetName: 'Sales',
      maxRows: 100,
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(mockExecutor.executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ args: { id: 'w1', maxRows: 100 } }),
    );
  });

  it('returns no-worksheet-found when the name does not match', async () => {
    const mockExecutor = executorFor([{ id: 'w9', name: 'Other' }]);

    const result = await getWorksheetSummaryData({
      worksheetName: 'Sales',
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'get-worksheet-summary-data-error');
      expect(result.error.error.type).toBe('no-worksheet-found');
      expect(result.error.error.message).toContain('Sales');
    }
  });

  it('returns execute-command-error when the list command fails', async () => {
    const error = { type: 'command-failed' as const, error: { code: 'ERROR', message: 'Failed' } };
    const mockExecutor = {
      executeCommand: vi.fn().mockResolvedValue(Err(error)),
    } as unknown as LocalExecutor;

    const result = await getWorksheetSummaryData({
      worksheetName: 'Sales',
      executor: mockExecutor,
      signal: mockSignal,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      invariant(result.error.type === 'execute-command-error');
      expect(result.error.error).toEqual(error);
    }
  });
});
