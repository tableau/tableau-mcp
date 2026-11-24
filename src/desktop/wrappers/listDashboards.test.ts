import { Ok } from 'ts-results-es';

import { makeExecutorMock } from '../externalApi/executor.mock.js';
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
    });

    const result = await listDashboards({ executor, signal });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      count: 1,
      dashboards: [dashboard],
    });
  });
});
