import { Ok } from 'ts-results-es';

import { makeExecutorMock } from '../externalApi/executor.mock.js';
import { getWorksheetXml } from './getWorksheetXml.js';

describe('getWorksheetXml', () => {
  it('resolves worksheet name to id and fetches the per-item document', async () => {
    const signal = new AbortController().signal;
    const executor = makeExecutorMock({
      listWorksheets: vi.fn().mockResolvedValue(
        Ok({
          worksheets: [
            { id: 'sheet-1', name: 'Sales' },
            { id: 'sheet-2', name: 'Profit' },
          ],
        }),
      ),
      getWorksheetDocument: vi.fn().mockResolvedValue(Ok({ xml: '<worksheet name="Profit" />' })),
    });

    const result = await getWorksheetXml({
      executor,
      signal,
      worksheetName: 'Profit',
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().xml).toBe('<worksheet name="Profit" />');
    expect(result.unwrap().name).toBe('Profit');
    expect(executor.getWorksheetDocument).toHaveBeenCalledWith('sheet-2', expect.any(AbortSignal));
  });

  it('accepts worksheet id directly before name matching', async () => {
    const signal = new AbortController().signal;
    const executor = makeExecutorMock({
      listWorksheets: vi.fn().mockResolvedValue(
        Ok({
          worksheets: [{ id: 'sheet-1', name: 'Sales' }],
        }),
      ),
      getWorksheetDocument: vi.fn().mockResolvedValue(Ok({ xml: '<worksheet name="Sales" />' })),
    });

    const result = await getWorksheetXml({
      executor,
      signal,
      worksheetName: 'sheet-1',
    });

    expect(result.isOk()).toBe(true);
    expect(executor.getWorksheetDocument).toHaveBeenCalledWith('sheet-1', expect.any(AbortSignal));
  });

  it('returns no-worksheet-found when the first-class list has no matching worksheet', async () => {
    const signal = new AbortController().signal;
    const executor = makeExecutorMock({
      listWorksheets: vi.fn().mockResolvedValue(
        Ok({
          worksheets: [{ id: 'sheet-1', name: 'Sales' }],
        }),
      ),
      getWorksheetDocument: vi.fn(),
    });

    const result = await getWorksheetXml({
      executor,
      signal,
      worksheetName: 'Profit',
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toEqual({
      type: 'get-worksheet-xml-error',
      error: {
        type: 'no-worksheet-found',
        message: 'Worksheet "Profit" was not found. Available worksheets: Sales (sheet-1)',
      },
    });
    expect(executor.getWorksheetDocument).not.toHaveBeenCalled();
  });
});
