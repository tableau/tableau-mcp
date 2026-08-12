import { Err, Ok } from 'ts-results-es';

import { makeExecutorMock } from '../externalApi/executor.mock.js';
import { ExecuteCommandError } from '../externalApi/executorTypes.js';
import { listWorksheets } from './listWorksheets.js';

describe('listWorksheets', () => {
  it('uses the first-class worksheet list endpoint without fetching the workbook document', async () => {
    const signal = new AbortController().signal;
    const executor = makeExecutorMock({
      listWorksheets: vi.fn().mockResolvedValue(
        Ok({
          worksheets: [{ id: 'sheet-1', name: 'Sales & Profit' }],
        }),
      ),
      executeCommand: vi.fn(),
    });

    const result = await listWorksheets({ executor, signal });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      count: 1,
      worksheets: [{ id: 'sheet-1', name: 'Sales & Profit' }],
    });
    expect(executor.executeCommand).not.toHaveBeenCalled();
  });

  it('falls back to the External API whole-document read when the first-class route is missing', async () => {
    const signal = new AbortController().signal;
    const routeMissing = {
      type: 'command-failed',
      error: { code: 'not-found', message: 'No route matches /v0/workbook/worksheets' },
    } as ExecuteCommandError;
    const executor = makeExecutorMock({
      listWorksheets: vi.fn().mockResolvedValue(Err(routeMissing)),
      getWorkbookDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: `<workbook><worksheets>
            <worksheet name="Sales &amp; Profit" />
            <worksheet name="Dashboard Source" />
          </worksheets></workbook>`,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
        }),
      ),
    });

    const result = await listWorksheets({ executor, signal });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      count: 2,
      worksheets: [{ name: 'Sales & Profit' }, { name: 'Dashboard Source' }],
    });
    expect(executor.getWorkbookDocument).toHaveBeenCalledWith(signal);
  });
});
