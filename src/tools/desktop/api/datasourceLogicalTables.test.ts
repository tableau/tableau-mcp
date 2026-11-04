import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getDatasourceUnderlyingDataTool } from './getDatasourceUnderlyingData.js';
import { getListDatasourceLogicalTablesTool } from './listDatasourceLogicalTables.js';

vi.mock('../../../desktop/session/sessionResolution.js');

type ToolFactory =
  | typeof getListDatasourceLogicalTablesTool
  | typeof getDatasourceUnderlyingDataTool;

describe('datasource logical table tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it.each([
    ['list-datasource-logical-tables', getListDatasourceLogicalTablesTool],
    ['get-datasource-underlying-data', getDatasourceUnderlyingDataTool],
  ] as const)('declares %s as a read-only 0.2.31 tool', (name, factory) => {
    const tool = factory(new DesktopMcpServer());

    expect(tool.name).toBe(name);
    expect(tool.minApiVersion).toBe('0.2.31');
    expect(tool.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  describe('list-datasource-logical-tables', () => {
    it('resolves the datasource name and lists its tables', async () => {
      const harness = await startHarness(getListDatasourceLogicalTablesTool);
      try {
        const result = await harness.callTool({ datasourceName: 'Sample - Superstore' });

        expect(result.isError).toBe(false);
        expect(parseResult(result)).toEqual({
          tables: [
            { id: 'lt-orders', caption: 'Orders' },
            { id: 'lt-returns', caption: 'Returns' },
          ],
        });
        expect(requestPaths(harness.server)).toEqual([
          '/v0/workbook/datasources',
          '/v0/workbook/datasources/wb-ds-superstore/logicalTables',
        ]);
      } finally {
        await harness.close();
      }
    });

    it('returns an error for an unknown datasource', async () => {
      const harness = await startHarness(getListDatasourceLogicalTablesTool);
      try {
        const result = await harness.callTool({ datasourceName: 'Missing' });

        expect(result.isError).toBe(true);
        expect(requestPaths(harness.server)).toEqual(['/v0/workbook/datasources']);
      } finally {
        await harness.close();
      }
    });
  });

  describe('get-datasource-underlying-data', () => {
    it('resolves the table caption and reads its data with the default row cap', async () => {
      const harness = await startHarness(getDatasourceUnderlyingDataTool);
      try {
        const result = await harness.callTool({
          datasourceName: 'Sample - Superstore',
          logicalTable: 'Orders',
        });

        expect(result.isError).toBe(false);
        expect(parseResult(result)).toMatchObject({
          rows: [
            ['West', 1200, 240],
            ['East', 900, 120],
          ],
        });
        const dataRequest = harness.server.requests.at(-1);
        expect(dataRequest?.path).toBe(
          '/v0/workbook/datasources/wb-ds-superstore/logicalTables/lt-orders/data',
        );
        expect(dataRequest?.searchParams).toEqual({ maxRows: '200' });
      } finally {
        await harness.close();
      }
    });

    it.each([
      ['Region', '[Sample - Superstore].[Region]'],
      ['[Region]', '[Sample - Superstore].[Region]'],
      ['[Other].[Profit]', '[Other].[Profit]'],
    ])('caps maxRows and sends column %s as %s', async (column, expected) => {
      const harness = await startHarness(getDatasourceUnderlyingDataTool);
      try {
        await harness.callTool({
          datasourceName: 'wb-ds-superstore',
          logicalTable: 'lt-returns',
          maxRows: 5000,
          columns: [column],
        });

        const dataRequest = harness.server.requests.at(-1);
        expect(dataRequest?.path).toBe(
          '/v0/workbook/datasources/wb-ds-superstore/logicalTables/lt-returns/data',
        );
        expect(dataRequest?.searchParams).toEqual({
          maxRows: '1000',
          columnsToIncludeByFieldName: expected,
        });
      } finally {
        await harness.close();
      }
    });

    it('returns an error for an unknown logical table without reading data', async () => {
      const harness = await startHarness(getDatasourceUnderlyingDataTool);
      try {
        const result = await harness.callTool({
          datasourceName: 'Sample - Superstore',
          logicalTable: 'Missing',
        });

        expect(result.isError).toBe(true);
        expect(requestPaths(harness.server)).toEqual([
          '/v0/workbook/datasources',
          '/v0/workbook/datasources/wb-ds-superstore/logicalTables',
        ]);
      } finally {
        await harness.close();
      }
    });
  });
});

async function startHarness(factory: ToolFactory): Promise<{
  server: MockExternalApiServer;
  callTool: (args: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer();
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = factory(new DesktopMcpServer());
  const callback = (await Provider.from(tool.callback)) as (
    args: Record<string, unknown>,
    extra: ReturnType<typeof getMockRequestHandlerExtra>,
  ) => Promise<CallToolResult>;
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };

  return {
    server,
    callTool: async (args) => await callback(args, extra),
    close: async () => {
      executor.stop();
      await server.close();
    },
  };
}

function instanceFor(server: MockExternalApiServer): ExternalApiInstance {
  return {
    baseUrl: server.baseUrl,
    token: 'valid-token',
    pid: 999,
    instanceId: 'inst-datasource-logical-tables',
    apiVersion: '0.2.31',
  };
}

function requestPaths(server: MockExternalApiServer): Array<string> {
  return server.requests.map((request) => request.path);
}

function parseResult(result: CallToolResult): unknown {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}
