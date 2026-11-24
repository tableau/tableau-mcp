import { Ok } from 'ts-results-es';

import { makeExecutorMock } from '../externalApi/executor.mock.js';
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
    });

    const result = await listWorksheets({ executor, signal });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({
      count: 1,
      worksheets: [worksheet],
    });
  });
});
