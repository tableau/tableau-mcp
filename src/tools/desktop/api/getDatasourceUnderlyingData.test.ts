import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, rmSync } from 'fs';
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

vi.mock('../../../desktop/session/sessionResolution.js');

describe('get-datasource-underlying-data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('is a 0.2.31 tool that writes cache files in file mode', () => {
    const tool = getDatasourceUnderlyingDataTool(new DesktopMcpServer());

    expect(tool.minApiVersion).toBe('0.2.31');
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  describe('without logicalTableId', () => {
    it('lists the tables from one call by id', async () => {
      const harness = await startHarness();
      try {
        const result = await harness.callTool({ datasourceId: 'wb-ds-superstore' });

        expect(result.isError).toBe(false);
        expect(parseResult(result)).toEqual({
          tables: [
            { id: 'lt-orders', caption: 'Orders' },
            { id: 'lt-returns', caption: 'Returns' },
          ],
        });
        expect(requestPaths(harness.server)).toEqual([
          '/v0/workbook/datasources/wb-ds-superstore/logicalTables',
        ]);
      } finally {
        await harness.close();
      }
    });

    it('falls back to the datasource list when datasourceId is a name', async () => {
      const harness = await startHarness();
      try {
        const result = await harness.callTool({ datasourceId: 'Sample - Superstore' });

        expect(result.isError).toBe(false);
        expect(requestPaths(harness.server)).toEqual([
          '/v0/workbook/datasources/Sample%20-%20Superstore/logicalTables',
          '/v0/workbook/datasources',
          '/v0/workbook/datasources/wb-ds-superstore/logicalTables',
        ]);
      } finally {
        await harness.close();
      }
    });

    it('returns an error for an unknown datasource', async () => {
      const harness = await startHarness();
      try {
        const result = await harness.callTool({ datasourceId: 'Missing' });

        expect(result.isError).toBe(true);
        expect(requestPaths(harness.server)).toEqual([
          '/v0/workbook/datasources/Missing/logicalTables',
          '/v0/workbook/datasources',
        ]);
      } finally {
        await harness.close();
      }
    });

    it('rejects row params without making a call', async () => {
      const harness = await startHarness();
      try {
        const result = await harness.callTool({
          datasourceId: 'wb-ds-superstore',
          maxRows: 5,
          columns: ['Region'],
        });

        expect(result.isError).toBe(true);
        invariant(result.content[0].type === 'text');
        expect(result.content[0].text).toContain(
          'maxRows, columns apply only when reading rows. Pass logicalTableId',
        );
        expect(requestPaths(harness.server)).toEqual([]);
      } finally {
        await harness.close();
      }
    });
  });

  describe('with logicalTableId', () => {
    it('saves the rows to a JSON cache file by default and returns no rows inline', async () => {
      const harness = await startHarness();
      try {
        const result = await harness.callTool({
          datasourceId: 'wb-ds-superstore',
          logicalTableId: 'lt-orders',
          mode: undefined,
        });

        expect(result.isError).toBe(false);
        expect(result.content).toHaveLength(1);
        invariant(result.content[0].type === 'text');
        const match =
          /^Saved 2 rows x \d+ columns to cache file: (.*datasource-rows-.*\.json)$/.exec(
            result.content[0].text,
          );
        invariant(match);
        const cacheFile = match[1];
        try {
          expect(JSON.parse(readFileSync(cacheFile, 'utf-8'))).toMatchObject({
            rows: [
              ['West', 1200, 240],
              ['East', 900, 120],
            ],
          });
        } finally {
          rmSync(cacheFile, { force: true });
        }
      } finally {
        await harness.close();
      }
    });

    it('reads rows by id with the default row cap', async () => {
      const harness = await startHarness();
      try {
        const result = await harness.callTool({
          datasourceId: 'wb-ds-superstore',
          logicalTableId: 'lt-orders',
        });

        expect(result.isError).toBe(false);
        expect(parseResult(result)).toMatchObject({
          rows: [
            ['West', 1200, 240],
            ['East', 900, 120],
          ],
        });
        expect(requestPaths(harness.server)).toEqual([
          '/v0/workbook/datasources/wb-ds-superstore/logicalTables',
          '/v0/workbook/datasources/wb-ds-superstore/logicalTables/lt-orders/data',
        ]);
        expect(harness.server.requests.at(-1)?.searchParams).toEqual({ maxRows: '200' });
      } finally {
        await harness.close();
      }
    });

    it('resolves a datasource name and a table caption', async () => {
      const harness = await startHarness();
      try {
        const result = await harness.callTool({
          datasourceId: 'Sample - Superstore',
          logicalTableId: 'Orders',
        });

        expect(result.isError).toBe(false);
        expect(harness.server.requests.at(-1)?.path).toBe(
          '/v0/workbook/datasources/wb-ds-superstore/logicalTables/lt-orders/data',
        );
      } finally {
        await harness.close();
      }
    });

    it.each([
      ['Region', '[Sample - Superstore].[Region]'],
      ['[Region]', '[Sample - Superstore].[Region]'],
      ['[Other].[Profit]', '[Other].[Profit]'],
    ])('caps maxRows and sends column %s as %s', async (column, expected) => {
      const harness = await startHarness();
      try {
        await harness.callTool({
          datasourceId: 'wb-ds-superstore',
          logicalTableId: 'lt-returns',
          maxRows: 5000,
          columns: [column],
        });

        expect(requestPaths(harness.server)).toEqual([
          '/v0/workbook/datasources/wb-ds-superstore/logicalTables',
          '/v0/workbook/datasources',
          '/v0/workbook/datasources/wb-ds-superstore/logicalTables/lt-returns/data',
        ]);
        expect(harness.server.requests.at(-1)?.searchParams).toEqual({
          maxRows: '1000',
          columnsToIncludeByFieldName: expected,
        });
      } finally {
        await harness.close();
      }
    });

    it('lists the datasources once when a name fallback also qualifies columns', async () => {
      const harness = await startHarness();
      try {
        await harness.callTool({
          datasourceId: 'Sample - Superstore',
          logicalTableId: 'lt-orders',
          columns: ['Region'],
        });

        expect(
          requestPaths(harness.server).filter((path) => path === '/v0/workbook/datasources'),
        ).toHaveLength(1);
        expect(harness.server.requests.at(-1)?.searchParams.columnsToIncludeByFieldName).toBe(
          '[Sample - Superstore].[Region]',
        );
      } finally {
        await harness.close();
      }
    });

    it('returns an error for an unknown logical table without reading data', async () => {
      const harness = await startHarness();
      try {
        const result = await harness.callTool({
          datasourceId: 'wb-ds-superstore',
          logicalTableId: 'Missing',
        });

        expect(result.isError).toBe(true);
        expect(requestPaths(harness.server)).toEqual([
          '/v0/workbook/datasources/wb-ds-superstore/logicalTables',
        ]);
      } finally {
        await harness.close();
      }
    });
  });
});

async function startHarness(): Promise<{
  server: MockExternalApiServer;
  callTool: (args: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer();
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = getDatasourceUnderlyingDataTool(new DesktopMcpServer());
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
    callTool: async (args) => await callback({ mode: 'inline', ...args }, extra),
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
