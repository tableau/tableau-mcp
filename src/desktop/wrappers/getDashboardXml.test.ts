import { Ok } from 'ts-results-es';

import { makeExecutorMock } from '../externalApi/executor.mock.js';
import { getDashboardXml } from './getDashboardXml.js';

describe('getDashboardXml', () => {
  it('resolves dashboard name to id and fetches the per-item document', async () => {
    const signal = new AbortController().signal;
    const executor = makeExecutorMock({
      listDashboards: vi.fn().mockResolvedValue(
        Ok({
          dashboards: [
            { id: 'dashboard-1', name: 'Executive Overview' },
            { id: 'dashboard-2', name: 'Sales' },
          ],
        }),
      ),
      getDashboardDocument: vi.fn().mockResolvedValue(Ok({ xml: '<dashboard name="Sales" />' })),
    });

    const result = await getDashboardXml({
      executor,
      signal,
      dashboardName: 'Sales',
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().xml).toBe('<dashboard name="Sales" />');
    expect(result.unwrap().name).toBe('Sales');
    expect(executor.getDashboardDocument).toHaveBeenCalledWith(
      'dashboard-2',
      expect.any(AbortSignal),
    );
  });

  it('accepts dashboard id directly before name matching', async () => {
    const signal = new AbortController().signal;
    const executor = makeExecutorMock({
      listDashboards: vi.fn().mockResolvedValue(
        Ok({
          dashboards: [{ id: 'dashboard-1', name: 'Executive Overview' }],
        }),
      ),
      getDashboardDocument: vi
        .fn()
        .mockResolvedValue(Ok({ xml: '<dashboard name="Executive Overview" />' })),
    });

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
    const executor = makeExecutorMock({
      listDashboards: vi.fn().mockResolvedValue(
        Ok({
          dashboards: [{ id: 'dashboard-1', name: 'Executive Overview' }],
        }),
      ),
      getDashboardDocument: vi.fn(),
    });

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
});
