import { exportedForTesting as serverExportedForTesting } from '../server.js';
import { stubDefaultEnvVars } from '../testShared.js';
import { getMockRequestHandlerExtra } from '../tools/toolContext.mock.js';
import { z } from 'zod';

import { TableauCodeModeApi } from './tableauCodeModeApi.js';

const { Server } = serverExportedForTesting;

describe('TableauCodeModeApi', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function makeApiWithMockTool({
    operationId = 'listDatasources',
    toolName = 'list-datasources',
    paramsSchema = {},
    callback,
  }: {
    operationId?: string;
    toolName?: string;
    paramsSchema?: Record<string, unknown>;
    callback: (args: unknown) => Promise<any>;
  }): TableauCodeModeApi {
    const server = new Server();
    const api = new TableauCodeModeApi({
      server,
      authInfo: undefined,
      catalog: {
        operations: [
          {
            operationId,
            toolName: toolName as any,
            group: null,
            description: 'mock',
            summary: 'mock',
            annotations: undefined,
            parameters: [],
            aliases: { datasourceId: 'datasourceLuid' },
            examples: {
              minimalValidArgs: {
                datasourceLuid: 'abc',
                query: { fields: [{ fieldCaption: 'Sales', function: 'SUM' }] },
              },
            },
          },
        ],
        operationMap: { [operationId]: toolName } as any,
        byToolName: {} as any,
      },
    });

    (api as any)._toolByOperationId = new Map([[operationId, toolName]]);
    (api as any)._toolByName = new Map([
      [
        toolName,
        {
          paramsSchema,
          callback: async (args: unknown) => await callback(args),
        },
      ],
    ]);

    return api;
  }

  it('normalizes bounded-context empty response to empty data array', async () => {
    const api = makeApiWithMockTool({
      callback: async () => ({
        isError: false,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              type: 'empty',
              message: 'No datasources were found',
              metadata: { reason: 'no_results' },
            }),
          },
        ],
      }),
    });

    const result = await api.invoke({
      operationId: 'listDatasources',
      args: {},
      extra: getMockRequestHandlerExtra(),
    });

    expect((result as any).data).toEqual([]);
    expect((result as any).content).toEqual([]);
    expect((result as any).meta.reason).toBe('no_results');
  });

  it('truncates oversized list payloads and marks metadata', async () => {
    const veryLargeList = Array.from({ length: 2000 }, (_value, index) => ({
      id: `id-${index}`,
      value: 'x'.repeat(400),
    }));
    const api = makeApiWithMockTool({
      callback: async () => ({
        isError: false,
        content: [{ type: 'text', text: JSON.stringify(veryLargeList) }],
      }),
    });

    const result = await api.invoke({
      operationId: 'listDatasources',
      args: {},
      extra: getMockRequestHandlerExtra(),
    });

    expect((result as any).meta.truncated).toBe(true);
    expect(Array.isArray((result as any).data)).toBe(true);
    expect((result as any).meta.totalItems).toBe(2000);
    expect((result as any).meta.returnedItems).toBeGreaterThan(0);
  });

  it('accepts datasourceId alias for datasourceLuid', async () => {
    const callback = vi.fn().mockResolvedValue({
      isError: false,
      content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
    });
    const api = makeApiWithMockTool({
      operationId: 'queryDatasource',
      toolName: 'query-datasource',
      paramsSchema: {
        datasourceLuid: z.string(),
        query: z.object({ fields: z.array(z.object({ fieldCaption: z.string() })) }),
      },
      callback,
    });

    await api.invoke({
      operationId: 'queryDatasource',
      args: {
        datasourceId: 'abc',
        query: { fields: [{ fieldCaption: 'Sales' }] },
      },
      extra: getMockRequestHandlerExtra(),
    });

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        datasourceLuid: 'abc',
      }),
    );
  });

  it('normalizes common queryDatasource field/filter shorthand', async () => {
    const callback = vi.fn().mockResolvedValue({
      isError: false,
      content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
    });
    const api = makeApiWithMockTool({
      operationId: 'queryDatasource',
      toolName: 'query-datasource',
      paramsSchema: {
        datasourceLuid: z.string(),
        query: z.object({
          fields: z.array(z.object({ fieldCaption: z.string(), function: z.string().optional() })),
          filters: z.array(
            z.object({
              filterType: z.string(),
              field: z.object({ fieldCaption: z.string() }),
              quantitativeFilterType: z.string().optional(),
              min: z.number().optional(),
              max: z.number().optional(),
              values: z.array(z.any()).optional(),
            }),
          ),
        }),
      },
      callback,
    });

    await api.invoke({
      operationId: 'queryDatasource',
      args: {
        datasourceId: 'abc',
        query: {
          fields: [{ name: 'Avgscrmath', aggregation: 'avg' }],
          filters: [
            { field: 'Avgscrmath', operator: 'GREATER_THAN', value: 400 },
            { field: 'Virtual', operator: 'EQUALS', value: 'E' },
          ],
        },
      },
      extra: getMockRequestHandlerExtra(),
    });

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        datasourceLuid: 'abc',
        query: {
          fields: [{ fieldCaption: 'Avgscrmath', function: 'AVG' }],
          filters: [
            {
              filterType: 'QUANTITATIVE_NUMERICAL',
              quantitativeFilterType: 'MIN',
              field: { fieldCaption: 'Avgscrmath' },
              min: 400,
            },
            {
              filterType: 'SET',
              field: { fieldCaption: 'Virtual' },
              values: ['E'],
            },
          ],
        },
      }),
    );
  });

  it('returns prescriptive validation error with aliases and example', async () => {
    const api = makeApiWithMockTool({
      operationId: 'queryDatasource',
      toolName: 'query-datasource',
      paramsSchema: {
        datasourceLuid: z.string(),
        query: z.object({ fields: z.array(z.object({ fieldCaption: z.string() })) }),
      },
      callback: async () => ({
        isError: false,
        content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
      }),
    });

    let errorText = '';
    try {
      await api.invoke({
        operationId: 'queryDatasource',
        args: { datasourceId: 'abc' },
        extra: getMockRequestHandlerExtra(),
      });
    } catch (error) {
      errorText = String((error as Error).message);
    }

    expect(errorText).toContain('invalid-arguments');
    expect(errorText).toContain('datasourceLuid');
    expect(errorText).toContain('example');
    expect(errorText).toContain('aliases');
    expect(errorText).toContain('issues');
    expect(errorText).toContain('hints');
  });
});
