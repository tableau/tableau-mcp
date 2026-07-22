import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { isRouteMissing } from '../../../desktop/externalApi/toolUtils.js';
import { ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import { sessionRouteState } from '../../../desktop/route/route-state.js';
import * as sessionResolution from '../../../desktop/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getSummaryDataTool } from './getSummaryData.js';

vi.mock('../../../desktop/sessionResolution.js');

const resultSchema = z.object({
  worksheet: z.object({ id: z.string(), name: z.string() }),
  maxRows: z.number(),
  summaryData: z.object({
    columns: z.array(z.object({ name: z.string().optional(), dataType: z.string().optional() })),
    rows: z.array(z.array(z.unknown())),
  }),
});

type SummaryDataArgs = {
  session?: string;
  worksheet?: string;
  maxRows?: number;
  columns?: string[];
};
type SummaryDataHarness = {
  server: MockExternalApiServer;
  callTool: (args: SummaryDataArgs) => Promise<CallToolResult>;
  close: () => Promise<void>;
};

describe('getSummaryDataTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionRouteState.clear();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('describes the populated-sheet precondition and terminal outcomes', () => {
    const tool = getSummaryDataTool(new DesktopMcpServer());

    expect(tool.name).toBe('get-summary-data');
    expect(tool.description).toBe(
      'Read summary rows from a populated worksheet with fields on the view. Empty, no-row, failed, or repeated requests are terminal and must not be polled.',
    );
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      worksheet: expect.any(Object),
      maxRows: expect.any(Object),
      columns: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({
      title: 'Get Summary Data',
      readOnlyHint: true,
      openWorldHint: false,
    });
  });

  it('resolves an exact worksheet name to id and returns summary data', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({
        worksheet: 'Sales by Region',
        maxRows: 50,
        columns: ['Region', 'Sales'],
      });

      expect(result.isError).toBe(false);
      const body = parseResult(result);
      expect(body.worksheet).toEqual({ id: 'sheet-sales', name: 'Sales by Region' });
      expect(body.maxRows).toBe(50);
      expect(body.summaryData.rows).toEqual([
        ['West', 1200, 240],
        ['East', 900, 120],
      ]);

      const summaryRequest = harness.server.requests.at(-1) as any;
      expect(summaryRequest?.path).toBe('/v0/workbook/worksheets/sheet-sales/summaryData');
      expect(summaryRequest?.searchParams).toMatchObject({
        maxRows: '50',
        columnsToIncludeByFieldName: 'Region,Sales',
      });
    } finally {
      await harness.close();
    }
  });

  it('returns a terminal result without querying a worksheet that has no datasource', async () => {
    const harness = await startHarness((server) => {
      server.setOverride('GET /v0/workbook/worksheets', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          worksheets: [{ id: 'sheet-empty', name: 'Empty Sheet', hidden: false, datasources: [] }],
        }),
      });
    });

    try {
      const result = await harness.callTool({ worksheet: 'Empty Sheet' });

      expect(result.isError).toBe(false);
      expect(parseJsonResult(result)).toEqual({
        status: 'terminal',
        reason: 'empty-sheet',
        worksheet: { id: 'sheet-empty', name: 'Empty Sheet' },
        maxRows: 200,
        shape: '0 rows x 0 columns',
        summaryData: { columns: [], rows: [] },
        guidance:
          'This sheet has no marks to summarize. Do NOT call get-summary-data again for this ask — bind a chart first (bind-template) or name a populated sheet.',
      });
      expect(result.structuredContent).toEqual({
        nextAction: {
          label: 'Stop polling; bind a chart or choose a populated sheet',
          kind: 'done',
        },
      });
      expect(harness.server.requests.some((request) => request.path.endsWith('/summaryData'))).toBe(
        false,
      );
    } finally {
      await harness.close();
    }
  });

  it('returns a terminal result when the worksheet has no marks', async () => {
    const harness = await startHarness((server) => {
      server.setOverride('GET /v0/workbook/worksheets/sheet-sales/summaryData', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ columns: [], rows: [] }),
      });
    });

    try {
      const result = await harness.callTool({ worksheet: 'Sales by Region' });

      expect(result.isError).toBe(false);
      expect(parseJsonResult(result)).toMatchObject({
        status: 'terminal',
        reason: 'empty-sheet',
        shape: '0 rows x 0 columns',
        summaryData: { columns: [], rows: [] },
        guidance:
          'This sheet has no marks to summarize. Do NOT call get-summary-data again for this ask — bind a chart first (bind-template) or name a populated sheet.',
      });
      expect(result.structuredContent).toMatchObject({
        nextAction: { kind: 'done' },
      });
    } finally {
      await harness.close();
    }
  });

  it('returns a distinct terminal result when a populated worksheet query has zero rows', async () => {
    const harness = await startHarness((server) => {
      server.setOverride('GET /v0/workbook/worksheets/sheet-sales/summaryData', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ columns: [{ name: 'Sales', dataType: 'real' }], rows: [] }),
      });
    });

    try {
      const result = await harness.callTool({ worksheet: 'Sales by Region' });

      expect(result.isError).toBe(false);
      expect(parseJsonResult(result)).toMatchObject({
        status: 'terminal',
        reason: 'no-rows',
        shape: '0 rows x 1 columns',
        summaryData: { columns: [{ name: 'Sales', dataType: 'real' }], rows: [] },
        guidance:
          "The summary query returned no rows. Do NOT call get-summary-data again for this ask — the answer is 'no data'; say so.",
      });
      expect(result.structuredContent).toEqual({
        nextAction: { label: 'Stop — report that the query returned no data', kind: 'done' },
      });
    } finally {
      await harness.close();
    }
  });

  it('returns the same terminal repeat result on the second and third identical call', async () => {
    const harness = await startHarness();
    try {
      const args = {
        worksheet: 'Sales by Region',
        maxRows: 50,
        columns: ['Region', 'Sales'],
      };

      const first = await harness.callTool(args);
      const requestCountAfterFirst = harness.server.requests.length;
      const second = await harness.callTool(args);
      const third = await harness.callTool(args);

      expect(first.isError).toBe(false);
      expect(parseJsonResult(second)).toEqual({
        status: 'terminal',
        reason: 'repeated-request',
        guidance:
          'You already asked for this summary data with the same arguments. Do NOT call get-summary-data again for this ask; use the prior result or report that no data was available.',
      });
      expect(parseJsonResult(third)).toEqual(parseJsonResult(second));
      expect(second.structuredContent).toEqual({
        nextAction: { label: 'Stop — use the prior summary-data result', kind: 'done' },
      });
      expect(third.structuredContent).toEqual(second.structuredContent);
      expect(harness.server.requests).toHaveLength(requestCountAfterFirst);
    } finally {
      await harness.close();
    }
  });

  it('returns a terminal error when Desktop summary retrieval fails', async () => {
    const harness = await startHarness((server) => {
      server.setOverride('GET /v0/workbook/worksheets/sheet-sales/summaryData', {
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'summary-failed',
          title: 'Summary unavailable',
          status: 500,
          detail: 'Could not query worksheet',
        }),
      });
    });

    try {
      const result = await harness.callTool({ worksheet: 'Sales by Region' });

      expect(result.isError).toBe(true);
      expect(parseJsonResult(result)).toMatchObject({
        status: 'terminal',
        reason: 'request-failed',
        guidance:
          'get-summary-data could not retrieve rows. Do NOT call get-summary-data again for this ask; report the failure and use a populated worksheet only if the user requests another attempt.',
        error: { type: 'desktop-command-execution-error' },
      });
      expect(result.structuredContent).toEqual({
        nextAction: { label: 'Stop — report the summary-data retrieval failure', kind: 'done' },
      });
    } finally {
      await harness.close();
    }
  });

  it('passes an explicit session to the session resolver', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ session: 'desktop-2', worksheet: 'sheet-sales' });

      expect(result.isError).toBe(false);
      expect(sessionResolution.resolveSession).toHaveBeenCalledWith('desktop-2');
    } finally {
      await harness.close();
    }
  });

  it('uses the only worksheet when worksheet is omitted', async () => {
    const harness = await startHarness((server) => {
      server.setOverride('GET /v0/workbook/worksheets', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          worksheets: [{ id: 'sheet-only', name: 'Only Sheet', hidden: false }],
        }),
      });
      server.setOverride('GET /v0/workbook/worksheets/sheet-only/summaryData', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          columns: [{ name: 'Sales', dataType: 'real' }],
          rows: [[1200]],
        }),
      });
    });

    try {
      const result = await harness.callTool({});

      expect(result.isError).toBe(false);
      const body = parseResult(result);
      expect(body.worksheet).toEqual({ id: 'sheet-only', name: 'Only Sheet' });
    } finally {
      await harness.close();
    }
  });

  it('returns a terminal error with worksheet names when worksheet is omitted but ambiguous', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({});

      expect(result.isError).toBe(true);
      expect(parseJsonResult(result)).toMatchObject({
        status: 'terminal',
        reason: 'invalid-worksheet',
        guidance:
          'The requested worksheet is not a valid retrieval source. Do NOT call get-summary-data again for this ask; name a populated sheet or bind a chart first.',
        error: {
          type: 'args-validation',
          message: expect.stringContaining('Multiple worksheets exist'),
        },
      });
      expect(result.structuredContent).toMatchObject({
        nextAction: { kind: 'done' },
      });
    } finally {
      await harness.close();
    }
  });

  it('returns a terminal error when worksheet name is ambiguous', async () => {
    const harness = await startHarness((server) => {
      server.setOverride('GET /v0/workbook/worksheets', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          worksheets: [
            { id: 'sheet-a', name: 'Regional Sales', hidden: false },
            { id: 'sheet-b', name: 'Regional Sales', hidden: false },
          ],
        }),
      });
    });

    try {
      const result = await harness.callTool({ worksheet: 'Regional Sales' });

      expect(result.isError).toBe(true);
      expect(parseJsonResult(result)).toMatchObject({
        status: 'terminal',
        reason: 'invalid-worksheet',
        error: {
          message: expect.stringMatching(/matched multiple worksheets.*sheet-a.*sheet-b/),
        },
      });
    } finally {
      await harness.close();
    }
  });

  it('returns a terminal error with available names when worksheet is not found', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ worksheet: 'Missing Sheet' });

      expect(result.isError).toBe(true);
      expect(parseJsonResult(result)).toMatchObject({
        status: 'terminal',
        reason: 'invalid-worksheet',
        error: {
          message: expect.stringMatching(
            /Worksheet "Missing Sheet" was not found.*Sales by Region.*Profit by Category/,
          ),
        },
      });
    } finally {
      await harness.close();
    }
  });

  it('clamps maxRows to 1000 before querying summary data', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ worksheet: 'sheet-sales', maxRows: 5000 });

      expect(result.isError).toBe(false);
      expect(parseResult(result).maxRows).toBe(1000);

      const summaryRequest = harness.server.requests.at(-1) as any;
      expect(summaryRequest?.searchParams?.maxRows).toBe('1000');
    } finally {
      await harness.close();
    }
  });
});

async function startHarness(
  configure?: (server: MockExternalApiServer) => void | Promise<void>,
): Promise<SummaryDataHarness> {
  const server = await startMockExternalApiServer();
  await configure?.(server);
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = getSummaryDataTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };

  return {
    server,
    callTool: async (args: SummaryDataArgs) =>
      await callback(
        {
          session: args.session,
          worksheet: args.worksheet,
          maxRows: args.maxRows,
          columns: args.columns,
        },
        extra,
      ),
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
    instanceId: 'inst-summary-data',
    apiVersion: '1.0',
  };
}

function parseResult(result: CallToolResult): z.infer<typeof resultSchema> {
  return resultSchema.parse(parseJsonResult(result));
}

function parseJsonResult(result: CallToolResult): unknown {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}

describe('isRouteMissing', () => {
  it('detects the Desktop route miss before summary data support is available', () => {
    expect(
      isRouteMissing({
        type: 'command-failed',
        error: { code: 'not-found', message: 'No route matches the request path.' },
      }),
    ).toBe(true);
  });

  it('does not flag ordinary not-found errors (e.g. sheet-not-found)', () => {
    expect(
      isRouteMissing({
        type: 'command-failed',
        error: { code: 'not-found', message: 'Sheet not found' },
      }),
    ).toBe(false);
    expect(isRouteMissing({ type: 'unknown', error: 'x' })).toBe(false);
    expect(isRouteMissing(null)).toBe(false);
  });
});
