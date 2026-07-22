import { Err, Ok } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../externalApi/externalApiToolExecutor.js';
import { ExecuteCommandError } from '../../toolExecutor/toolExecutor.js';
import { listDashboards } from './listDashboards.js';

describe('listDashboards', () => {
  it('uses the first-class dashboard list endpoint without fetching the workbook document', async () => {
    const signal = new AbortController().signal;
    const executor = {
      listDashboards: vi.fn().mockResolvedValue(
        Ok({
          dashboards: [{ id: 'dashboard-1', name: 'Executive Overview' }],
        }),
      ),
      executeCommand: vi.fn(),
    } as unknown as ExternalApiToolExecutor;

    const result = await listDashboards({ executor, signal });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      count: 1,
      dashboards: ['Executive Overview'],
    });
    expect(executor.executeCommand).not.toHaveBeenCalled();
  });

  it('falls back to the External API whole-document read when the first-class route is missing', async () => {
    const signal = new AbortController().signal;
    const routeMissing = {
      type: 'command-failed',
      error: { code: 'not-found', message: 'No route matches /v0/workbook/dashboards' },
    } as ExecuteCommandError;
    const executor = {
      listDashboards: vi.fn().mockResolvedValue(Err(routeMissing)),
      getWorkbookDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: `<workbook><dashboards>
            <dashboard name="Executive &amp; Sales" />
            <dashboard name="Operations" />
          </dashboards></workbook>`,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
        }),
      ),
    } as unknown as ExternalApiToolExecutor;

    const result = await listDashboards({ executor, signal });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      count: 2,
      dashboards: ['Executive & Sales', 'Operations'],
    });
    expect(executor.getWorkbookDocument).toHaveBeenCalledWith(signal);
  });
});
