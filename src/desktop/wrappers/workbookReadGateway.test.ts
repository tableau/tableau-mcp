import { ExternalApiToolExecutor } from '../externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../externalApi/types.js';
import { WorkbookReadGateway } from './workbookReadGateway.js';

const signal = new AbortController().signal;

describe('WorkbookReadGateway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('selects first-class External API reads when given an External API executor', async () => {
    const server = await startMockExternalApiServer();
    const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
    const gateway = new WorkbookReadGateway({
      executor,
      signal,
    });

    try {
      const result = await gateway.listWorksheets();

      expect(gateway.mode).toBe('external-api');
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.worksheets).toEqual([
          {
            id: 'sheet-sales',
            name: 'Sales by Region',
            type: 'WORKSHEET',
            hidden: false,
            isActiveSheet: true,
            isAutoUpdatesPaused: false,
            index: 0,
            datasources: ['Sample - Superstore'],
          },
          {
            id: 'sheet-profit',
            name: 'Profit by Category',
            type: 'WORKSHEET',
            hidden: false,
            isActiveSheet: false,
            isAutoUpdatesPaused: true,
            index: 1,
            datasources: ['Sample - Superstore'],
          },
        ]);
      }
      expect(server.requests.map((request) => request.path)).toEqual(['/v0/workbook/worksheets']);
    } finally {
      executor.stop();
      await server.close();
    }
  });
});

function instanceFor(server: MockExternalApiServer): ExternalApiInstance {
  return {
    baseUrl: server.baseUrl,
    token: 'valid-token',
    pid: 999,
    instanceId: 'inst-workbook-read-gateway',
    apiVersion: '1.0',
  };
}
