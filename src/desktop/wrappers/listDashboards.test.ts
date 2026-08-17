import { Err, Ok } from 'ts-results-es';

import { makeExecutorMock } from '../externalApi/executor.mock.js';
import { ExecuteCommandError } from '../externalApi/executorTypes.js';
import { listDashboards } from './listDashboards.js';

describe('listDashboards', () => {
  it('uses the first-class dashboard list endpoint without fetching the workbook document', async () => {
    const signal = new AbortController().signal;
    const dashboard = {
      id: 'dashboard-1',
      name: 'Executive Overview',
      hidden: false,
      isActiveSheet: false,
      isAutoUpdatesPaused: false,
      index: 2,
      containedSheets: ['sheet-1', 'sheet-2'],
    };
    const executor = makeExecutorMock({
      listDashboards: vi.fn().mockResolvedValue(Ok({ dashboards: [dashboard] })),
      executeCommand: vi.fn(),
    });

    const result = await listDashboards({ executor, signal });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      count: 1,
      dashboards: [dashboard],
    });
    expect(executor.executeCommand).not.toHaveBeenCalled();
  });

  it('falls back to the External API whole-document read when the first-class route is missing', async () => {
    const signal = new AbortController().signal;
    const routeMissing = {
      type: 'command-failed',
      error: { code: 'not-found', message: 'No route matches /v0/workbook/dashboards' },
    } as ExecuteCommandError;
    const executor = makeExecutorMock({
      listDashboards: vi.fn().mockResolvedValue(Err(routeMissing)),
      getWorkbookDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: `<workbook><dashboards>
            <dashboard name="Executive &amp; Sales"><simple-id uuid="{DB-1}" /></dashboard>
            <dashboard name="Operations"><simple-id uuid="{DB-2}" /></dashboard>
          </dashboards></workbook>`,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
        }),
      ),
    });

    const result = await listDashboards({ executor, signal });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      count: 2,
      dashboards: [
        { id: '{DB-1}', name: 'Executive & Sales' },
        { id: '{DB-2}', name: 'Operations' },
      ],
    });
    expect(executor.getWorkbookDocument).toHaveBeenCalledWith(signal);
  });
});
