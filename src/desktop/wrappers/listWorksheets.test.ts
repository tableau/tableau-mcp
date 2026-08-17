import { Err, Ok } from 'ts-results-es';

import { makeExecutorMock } from '../externalApi/executor.mock.js';
import { ExecuteCommandError } from '../externalApi/executorTypes.js';
import { listWorksheets } from './listWorksheets.js';

describe('listWorksheets', () => {
  it('uses the first-class worksheet list endpoint without fetching the workbook document', async () => {
    const signal = new AbortController().signal;
    const worksheet = {
      id: 'sheet-1',
      name: 'Sales & Profit',
      hidden: false,
      isActiveSheet: true,
      isAutoUpdatesPaused: false,
      index: 0,
      datasources: ['Sample - Superstore'],
    };
    const executor = makeExecutorMock({
      listWorksheets: vi.fn().mockResolvedValue(Ok({ worksheets: [worksheet] })),
      executeCommand: vi.fn(),
    });

    const result = await listWorksheets({ executor, signal });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      count: 1,
      worksheets: [worksheet],
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
            <worksheet name="Sales &amp; Profit"><simple-id uuid="{WS-1}" /></worksheet>
            <worksheet name="Dashboard Source"><simple-id uuid="{WS-2}" /></worksheet>
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
      worksheets: [
        { id: '{WS-1}', name: 'Sales & Profit' },
        { id: '{WS-2}', name: 'Dashboard Source' },
      ],
    });
    expect(executor.getWorkbookDocument).toHaveBeenCalledWith(signal);
  });
});
