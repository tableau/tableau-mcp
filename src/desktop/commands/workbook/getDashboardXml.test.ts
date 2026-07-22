import { Err, Ok } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../externalApi/externalApiToolExecutor.js';
import { ExecuteCommandError } from '../../toolExecutor/toolExecutor.js';
import { getDashboardFragment, getDashboardXml } from './getDashboardXml.js';

describe('getDashboardXml', () => {
  it('resolves dashboard name to id and fetches the per-item document', async () => {
    const signal = new AbortController().signal;
    const executor = {
      listDashboards: vi.fn().mockResolvedValue(
        Ok({
          dashboards: [
            { id: 'dashboard-1', name: 'Executive Overview' },
            { id: 'dashboard-2', name: 'Sales' },
          ],
        }),
      ),
      getDashboardDocument: vi.fn().mockResolvedValue(Ok({ xml: '<dashboard name="Sales" />' })),
      executeCommand: vi.fn(),
    } as unknown as ExternalApiToolExecutor;

    const result = await getDashboardXml({
      executor,
      signal,
      dashboardName: 'Sales',
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('<dashboard name="Sales" />');
    expect(executor.getDashboardDocument).toHaveBeenCalledWith(
      'dashboard-2',
      expect.any(AbortSignal),
    );
    expect(executor.executeCommand).not.toHaveBeenCalled();
  });

  it('accepts dashboard id directly before name matching', async () => {
    const signal = new AbortController().signal;
    const executor = {
      listDashboards: vi.fn().mockResolvedValue(
        Ok({
          dashboards: [{ id: 'dashboard-1', name: 'Executive Overview' }],
        }),
      ),
      getDashboardDocument: vi
        .fn()
        .mockResolvedValue(Ok({ xml: '<dashboard name="Executive Overview" />' })),
    } as unknown as ExternalApiToolExecutor;

    const result = await getDashboardXml({
      executor,
      signal,
      dashboardName: 'dashboard-1',
    });

    expect(result.isOk()).toBe(true);
    expect(executor.getDashboardDocument).toHaveBeenCalledWith(
      'dashboard-1',
      expect.any(AbortSignal),
    );
  });

  it('returns no-dashboard-found when the first-class list has no matching dashboard', async () => {
    const signal = new AbortController().signal;
    const executor = {
      listDashboards: vi.fn().mockResolvedValue(
        Ok({
          dashboards: [{ id: 'dashboard-1', name: 'Executive Overview' }],
        }),
      ),
      getDashboardDocument: vi.fn(),
    } as unknown as ExternalApiToolExecutor;

    const result = await getDashboardXml({
      executor,
      signal,
      dashboardName: 'Sales',
    });

    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr()).toEqual({
      type: 'get-dashboard-xml-error',
      error: {
        type: 'no-dashboard-found',
        message:
          'Dashboard "Sales" was not found. Available dashboards: Executive Overview (dashboard-1)',
      },
    });
    expect(executor.getDashboardDocument).not.toHaveBeenCalled();
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
            <dashboard name="Sales"><zone /></dashboard>
          </dashboards></workbook>`,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
        }),
      ),
    } as unknown as ExternalApiToolExecutor;

    const result = await getDashboardXml({
      executor,
      signal,
      dashboardName: 'Sales',
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toContain('<dashboard name="Sales">');
    expect(executor.getWorkbookDocument).toHaveBeenCalledWith(signal);
  });
});

describe('getDashboardFragment', () => {
  it('slices the requested dashboard out of a whole-workbook /document response', async () => {
    const signal = new AbortController().signal;
    const executor = {
      listDashboards: vi.fn().mockResolvedValue(
        Ok({
          dashboards: [
            { id: 'dashboard-1', name: 'Executive Overview' },
            { id: 'dashboard-2', name: 'Sales' },
          ],
        }),
      ),
      getDashboardDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: `<workbook><dashboards>
            <dashboard name="Executive Overview"><zone /></dashboard>
            <dashboard name="Sales"><zone /></dashboard>
          </dashboards></workbook>`,
        }),
      ),
    } as unknown as ExternalApiToolExecutor;

    const result = await getDashboardFragment({
      executor,
      signal,
      dashboardName: 'Sales',
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toContain('<dashboard name="Sales"');
      expect(result.value).not.toContain('<workbook');
      expect(result.value).not.toContain('Executive Overview');
    }
  });

  it('returns a bare dashboard fragment unchanged', async () => {
    const signal = new AbortController().signal;
    const executor = {
      listDashboards: vi.fn().mockResolvedValue(
        Ok({
          dashboards: [{ id: 'dashboard-1', name: 'Sales' }],
        }),
      ),
      getDashboardDocument: vi.fn().mockResolvedValue(Ok({ xml: '<dashboard name="Sales" />' })),
    } as unknown as ExternalApiToolExecutor;

    const result = await getDashboardFragment({
      executor,
      signal,
      dashboardName: 'Sales',
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('<dashboard name="Sales" />');
  });
});
