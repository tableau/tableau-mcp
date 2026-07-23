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
import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getSummaryDataTool } from './getSummaryData.js';

vi.mock('../../../desktop/sessionResolution.js');

const resultSchema = z.object({
  status: z.literal('success'),
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

  it('describes populated-sheet summary reads and one transient retry', () => {
    const tool = getSummaryDataTool(new DesktopMcpServer());

    expect(tool.name).toBe('get-summary-data');
    expect(tool.description).toBe(
      'Read summary rows from a populated worksheet with fields on the view. A terminal/no-data result means stop; a transient failure may be retried once.',
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
      expect(body.status).toBe('success');
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
          label: 'Data retrieval complete — no further calls needed',
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
        nextAction: {
          label: 'Data retrieval complete — no further calls needed',
          kind: 'done',
        },
      });
    } finally {
      await harness.close();
    }
  });

  it('does not replay a prior success payload for repeated calls', async () => {
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

      expect(first.isError).toBe(false);
      expect(second.isError).toBe(false);
      expect(parseResult(second)).toEqual(parseResult(first));
      expect(parseJsonResult(second)).not.toHaveProperty('guidance');
      expect(
        harness.server.requests.filter((request) => request.path.endsWith('/summaryData')),
      ).toHaveLength(2);
      expect(harness.server.requests.length).toBeGreaterThan(requestCountAfterFirst);
    } finally {
      await harness.close();
    }
  });

  it('keeps repeated empty-sheet calls terminal without replay guidance', async () => {
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
      const args = { worksheet: 'Empty Sheet' };
      const first = await harness.callTool(args);
      const repeated = await harness.callTool(args);
      const firstBody = parseJsonResult(first) as Record<string, unknown>;

      expect(parseJsonResult(repeated)).toEqual({
        ...firstBody,
        guidance:
          'This sheet has no marks to summarize. Do NOT call get-summary-data again for this ask — bind a chart first (bind-template) or name a populated sheet.',
      });
      expect(repeated.structuredContent).toEqual(first.structuredContent);
      expect(harness.server.requests.some((request) => request.path.endsWith('/summaryData'))).toBe(
        false,
      );
    } finally {
      await harness.close();
    }
  });

  it('allows parallel first calls to execute without fabricating a prior result', async () => {
    const harness = await startHarness();
    try {
      const args = { worksheet: 'Sales by Region', columns: ['Region'] };
      const [first, parallel] = await Promise.all([harness.callTool(args), harness.callTool(args)]);

      expect(parseResult(first).status).toBe('success');
      expect(parseResult(parallel).status).toBe('success');
      expect(
        harness.server.requests.filter((request) => request.path.endsWith('/summaryData')),
      ).toHaveLength(2);
    } finally {
      await harness.close();
    }
  });

  it('marks the first transient Desktop failure retryable and clears it after a successful retry', async () => {
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
        status: 'retryable',
        reason: 'request-failed',
        guidance: expect.stringContaining('transient — one retry is reasonable'),
        error: { type: 'desktop-command-execution-error' },
      });
      expect(result.structuredContent).toEqual({
        nextAction: { label: 'Retry get-summary-data once', kind: 'prefill' },
      });

      harness.server.setOverride('GET /v0/workbook/worksheets/sheet-sales/summaryData', undefined);
      const retry = await harness.callTool({ worksheet: 'Sales by Region' });
      expect(parseResult(retry).status).toBe('success');
      expect(
        harness.server.requests.filter((request) => request.path.endsWith('/summaryData')),
      ).toHaveLength(2);
    } finally {
      await harness.close();
    }
  });

  it('escalates the second consecutive transient failure for the same signature to terminal', async () => {
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
      const first = await harness.callTool({ worksheet: 'Sales by Region', maxRows: 50 });
      const second = await harness.callTool({ worksheet: 'Sales by Region', maxRows: 50 });

      expect(parseJsonResult(first)).toMatchObject({
        status: 'retryable',
        reason: 'request-failed',
        guidance: expect.stringContaining('transient — one retry is reasonable'),
      });
      expect(parseJsonResult(second)).toMatchObject({
        status: 'terminal',
        reason: 'request-failed',
        guidance: expect.stringContaining('still failing — report the outcome; do not call again'),
      });
      expect(second.structuredContent).toEqual({
        nextAction: { label: 'Data retrieval failed — report outcome', kind: 'done' },
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

  it('marks session-resolution failures transient and allows retry', async () => {
    const harness = await startHarness();
    vi.mocked(sessionResolution.resolveSession).mockReturnValueOnce(
      new ArgsValidationError('Desktop discovery temporarily unavailable').toErr(),
    );

    try {
      const failed = await harness.callTool({ worksheet: 'Sales by Region' });

      expect(failed.isError).toBe(true);
      expect(parseJsonResult(failed)).toMatchObject({
        status: 'retryable',
        reason: 'session-resolution-failed',
        guidance: expect.stringContaining('transient — one retry is reasonable'),
      });

      const retry = await harness.callTool({ worksheet: 'Sales by Region' });
      expect(parseResult(retry).status).toBe('success');
    } finally {
      await harness.close();
    }
  });

  it('does not escalate a session-resolution failure after an intervening success', async () => {
    const harness = await startHarness();
    vi.mocked(sessionResolution.resolveSession).mockReturnValueOnce(
      new ArgsValidationError('Desktop discovery temporarily unavailable').toErr(),
    );

    try {
      const firstFailure = await harness.callTool({ worksheet: 'Sales by Region', maxRows: 50 });
      const success = await harness.callTool({ worksheet: 'Sales by Region', maxRows: 50 });
      vi.mocked(sessionResolution.resolveSession).mockReturnValueOnce(
        new ArgsValidationError('Desktop discovery temporarily unavailable').toErr(),
      );
      const nextFailure = await harness.callTool({ worksheet: 'Sales by Region', maxRows: 50 });

      expect(parseJsonResult(firstFailure)).toMatchObject({
        status: 'retryable',
        reason: 'session-resolution-failed',
      });
      expect(parseResult(success).status).toBe('success');
      expect(parseJsonResult(nextFailure)).toMatchObject({
        status: 'retryable',
        reason: 'session-resolution-failed',
        guidance: expect.stringContaining('transient — one retry is reasonable'),
      });
      expect(nextFailure.structuredContent).toEqual({
        nextAction: { label: 'Retry get-summary-data once', kind: 'prefill' },
      });
    } finally {
      await harness.close();
    }
  });

  it('escalates the second consecutive session-resolution failure for the same signature to terminal', async () => {
    const harness = await startHarness();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(
      new ArgsValidationError('Desktop discovery temporarily unavailable').toErr(),
    );

    try {
      const first = await harness.callTool({ worksheet: 'Sales by Region', maxRows: 50 });
      const second = await harness.callTool({ worksheet: 'Sales by Region', maxRows: 50 });

      expect(parseJsonResult(first)).toMatchObject({
        status: 'retryable',
        reason: 'session-resolution-failed',
        guidance: expect.stringContaining('transient — one retry is reasonable'),
      });
      expect(parseJsonResult(second)).toMatchObject({
        status: 'terminal',
        reason: 'session-resolution-failed',
        guidance: expect.stringContaining('still failing — report the outcome; do not call again'),
      });
      expect(second.structuredContent).toEqual({
        nextAction: { label: 'Data retrieval failed — report outcome', kind: 'done' },
      });
    } finally {
      await harness.close();
    }
  });

  it('keeps first session-resolution failures retryable for distinct requested sessions', async () => {
    const harness = await startHarness();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(
      new ArgsValidationError('Desktop discovery temporarily unavailable').toErr(),
    );

    try {
      const sessionA = await harness.callTool({
        session: 'desktop-a',
        worksheet: 'Sales by Region',
        maxRows: 50,
      });
      const sessionB = await harness.callTool({
        session: 'desktop-b',
        worksheet: 'Sales by Region',
        maxRows: 50,
      });

      expect(parseJsonResult(sessionA)).toMatchObject({
        status: 'retryable',
        reason: 'session-resolution-failed',
        guidance: expect.stringContaining('transient — one retry is reasonable'),
      });
      expect(parseJsonResult(sessionB)).toMatchObject({
        status: 'retryable',
        reason: 'session-resolution-failed',
        guidance: expect.stringContaining('transient — one retry is reasonable'),
      });
      expect(sessionB.structuredContent).toEqual({
        nextAction: { label: 'Retry get-summary-data once', kind: 'prefill' },
      });
    } finally {
      await harness.close();
    }
  });

  it('escalates the second consecutive caught exception for the same signature to terminal', async () => {
    const harness = await startHarness();
    vi.mocked(sessionResolution.resolveSession).mockImplementation(() => {
      throw new Error('Desktop discovery exploded');
    });

    try {
      const first = await harness.callTool({ worksheet: 'Sales by Region', maxRows: 50 });
      const second = await harness.callTool({ worksheet: 'Sales by Region', maxRows: 50 });

      expect(parseJsonResult(first)).toMatchObject({
        status: 'retryable',
        reason: 'request-failed',
        guidance: expect.stringContaining('transient — one retry is reasonable'),
        error: { type: 'unknown', message: 'Desktop discovery exploded' },
      });
      expect(parseJsonResult(second)).toMatchObject({
        status: 'terminal',
        reason: 'request-failed',
        guidance: expect.stringContaining('still failing — report the outcome; do not call again'),
      });
      expect(second.structuredContent).toEqual({
        nextAction: { label: 'Data retrieval failed — report outcome', kind: 'done' },
      });
    } finally {
      await harness.close();
    }
  });

  it('keeps unresolved-session and resolved-session transient scopes separate', async () => {
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
    vi.mocked(sessionResolution.resolveSession).mockReturnValueOnce(
      new ArgsValidationError('Desktop discovery temporarily unavailable').toErr(),
    );

    try {
      const unresolvedFailure = await harness.callTool({
        worksheet: 'Sales by Region',
        maxRows: 50,
      });
      const resolvedTransportFailure = await harness.callTool({
        worksheet: 'Sales by Region',
        maxRows: 50,
      });
      const secondResolvedTransportFailure = await harness.callTool({
        worksheet: 'Sales by Region',
        maxRows: 50,
      });

      expect(parseJsonResult(unresolvedFailure)).toMatchObject({
        status: 'retryable',
        reason: 'session-resolution-failed',
      });
      expect(parseJsonResult(resolvedTransportFailure)).toMatchObject({
        status: 'retryable',
        reason: 'request-failed',
        guidance: expect.stringContaining('transient — one retry is reasonable'),
      });
      expect(parseJsonResult(secondResolvedTransportFailure)).toMatchObject({
        status: 'terminal',
        reason: 'request-failed',
        guidance: expect.stringContaining('still failing — report the outcome; do not call again'),
      });
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

  it('returns an action-required error with worksheet names when worksheet is omitted but ambiguous', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({});

      expect(result.isError).toBe(true);
      expect(parseJsonResult(result)).toMatchObject({
        status: 'action-required',
        reason: 'worksheet-ambiguous',
        guidance: 'Choose one worksheet by exact id or name, then call get-summary-data again.',
        error: {
          type: 'args-validation',
          message: expect.stringContaining('Multiple worksheets exist'),
        },
      });
      expect(result.structuredContent).toMatchObject({
        nextAction: { kind: 'prefill' },
      });
    } finally {
      await harness.close();
    }
  });

  it('returns an action-required error when worksheet name is ambiguous', async () => {
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
        status: 'action-required',
        reason: 'worksheet-ambiguous',
        error: {
          message: expect.stringMatching(/matched multiple worksheets.*sheet-a.*sheet-b/),
        },
      });
    } finally {
      await harness.close();
    }
  });

  it('returns an action-required repair error with available names when worksheet is not found', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ worksheet: 'Missing Sheet' });

      expect(result.isError).toBe(true);
      expect(parseJsonResult(result)).toMatchObject({
        status: 'action-required',
        reason: 'worksheet-not-found',
        guidance:
          'The requested worksheet was not found. Choose an available populated worksheet, correct the worksheet name/id, or bind a chart first; then call get-summary-data again.',
        error: {
          message: expect.stringMatching(
            /Worksheet "Missing Sheet" was not found.*Sales by Region.*Profit by Category/,
          ),
        },
      });
      expect(result.structuredContent).toEqual({
        nextAction: { label: 'Repair worksheet selection and retry', kind: 'prefill' },
      });
    } finally {
      await harness.close();
    }
  });

  it('uses endpoint-unavailable guidance when Desktop lacks the summary-data route', async () => {
    const harness = await startHarness((server) => {
      server.setOverride('GET /v0/workbook/worksheets/sheet-sales/summaryData', {
        status: 404,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'problem',
          title: 'No route matches GET /v0/workbook/worksheets/sheet-sales/summaryData',
          status: 404,
          instance: '/v0/mock',
          detail: 'No route matches GET /v0/workbook/worksheets/sheet-sales/summaryData',
          code: 'not-found',
        }),
      });
    });

    try {
      const result = await harness.callTool({ worksheet: 'Sales by Region' });

      expect(result.isError).toBe(true);
      expect(parseJsonResult(result)).toMatchObject({
        status: 'action-required',
        reason: 'endpoint-unavailable',
        guidance: expect.stringContaining('Desktop build'),
      });
      expect(result.structuredContent).toEqual({
        nextAction: { label: 'Update Desktop/API and retry', kind: 'prefill' },
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
