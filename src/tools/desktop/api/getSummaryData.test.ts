import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { isRouteMissing } from '../../../desktop/externalApi/toolUtils.js';
import { ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import { sessionRouteState } from '../../../desktop/route/route-state.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { ArgsValidationError, UnknownError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getSummaryDataTool } from './getSummaryData.js';
import { fetchWorksheetSummaryData, type SummaryDataRead } from './summaryDataCore.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const resultSchema = z.object({
  status: z.literal('success'),
  worksheet: z.object({ id: z.string(), name: z.string() }),
  maxRows: z.number(),
  summaryData: z.object({
    columns: z.array(z.object({ name: z.string().optional(), dataType: z.string().optional() })),
    rows: z.array(z.array(z.unknown())),
  }),
});

// Every terminal failure mints the same marker: the tool stopped, it retrieved nothing,
// and "terminal" is its own retry policy rather than a claim about Desktop.
const TERMINAL_FAILURE_NEXT_ACTION = {
  label: 'Data retrieval failed — report outcome',
  kind: 'done',
  receipt: {
    did: [expect.stringContaining('stopped get-summary-data on a terminal')],
    didNot: ['retrieve any summary data'],
    unverified: ['whether the underlying condition is permanent'],
  },
};

type SummaryDataArgs = {
  session?: string;
  worksheetName?: string;
  worksheet?: string;
  maxRows?: number;
  columns?: string[];
};
type SummaryDataHarness = {
  server: MockExternalApiServer;
  callTool: (args: SummaryDataArgs) => Promise<CallToolResult>;
  close: () => Promise<void>;
};

describe('fetchWorksheetSummaryData', () => {
  it('materializes a populated worksheet once before retrying an initially empty summary', async () => {
    const endpoints: string[] = [];
    let summaryReads = 0;
    const read = (async (endpoint: string) => {
      endpoints.push(endpoint);
      if (endpoint === 'worksheet list') {
        return Ok({
          worksheets: [
            {
              id: 'sheet-bubble',
              name: 'Sales vs Profit by Product',
              hidden: false,
              datasources: ['Sample - Superstore'],
            },
          ],
        });
      }
      if (endpoint === 'worksheet image') {
        return Ok({ imageBase64: 'cG5n', width: 1, height: 1 });
      }
      summaryReads += 1;
      return Ok(
        summaryReads === 1
          ? { columns: [], rows: [] }
          : {
              columns: [{ name: 'Product Name' }, { name: 'SUM(Sales)' }],
              rows: [['Acco 7-Outlet Power Adapter', 41.9]],
            },
      );
    }) as SummaryDataRead;

    const result = await fetchWorksheetSummaryData({
      read,
      worksheet: 'Sales vs Profit by Product',
      maxRows: 10,
      materializeEmpty: true,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw result.error;
    expect(result.value.columns).toEqual([{ name: 'Product Name' }, { name: 'SUM(Sales)' }]);
    expect(result.value.rows).toEqual([['Acco 7-Outlet Power Adapter', 41.9]]);
    expect(endpoints).toEqual([
      'worksheet list',
      'summary-data',
      'worksheet image',
      'summary-data',
    ]);
  });

  it('surfaces a materialization failure instead of misreporting a populated sheet as empty', async () => {
    const renderError = new UnknownError('worksheet image failed');
    const read = (async (endpoint: string) => {
      if (endpoint === 'worksheet list') {
        return Ok({
          worksheets: [
            {
              id: 'sheet-bubble',
              name: 'Sales vs Profit by Product',
              hidden: false,
              datasources: ['Sample - Superstore'],
            },
          ],
        });
      }
      if (endpoint === 'worksheet image') return Err(renderError);
      return Ok({ columns: [], rows: [] });
    }) as SummaryDataRead;

    const result = await fetchWorksheetSummaryData({
      read,
      worksheet: 'Sales vs Profit by Product',
      maxRows: 10,
      materializeEmpty: true,
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) throw new Error('expected materialization failure');
    expect(result.error).toEqual({ type: 'request', error: renderError });
  });
});

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
      worksheetName: expect.any(Object),
      maxRows: expect.any(Object),
      columns: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({
      readOnlyHint: true,
      openWorldHint: false,
    });
  });

  it('resolves an exact worksheet name to id and returns summary data', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({
        worksheetName: 'Sales by Region',
        maxRows: 50,
        columns: ['Region', 'Sales'],
      });

      expect(result.isError).toBe(false);
      const body = parseResult(result);
      expect(body.status).toBe('success');
      expect(body.worksheet).toEqual({ id: 'sheet-sales', name: 'Sales by Region' });
      expect(body.maxRows).toBe(50);
      expect(body.summaryData.columns).toEqual([
        { name: 'Region', dataType: 'string' },
        { name: 'Sales', dataType: 'real' },
      ]);
      expect(body.summaryData.rows).toEqual([
        ['West', 1200],
        ['East', 900],
      ]);

      const summaryRequest = harness.server.requests.at(-1) as any;
      expect(summaryRequest?.path).toBe('/v0/workbook/worksheets/sheet-sales/summaryData');
      // Columns are projected from the returned data client-side, so no column filter is sent.
      expect(summaryRequest?.searchParams).toMatchObject({
        maxRows: '50',
        ignoreSelection: 'true',
      });
      expect(summaryRequest?.searchParams).not.toHaveProperty('columnsToIncludeByFieldName');
    } finally {
      await harness.close();
    }
  });

  it('projects requested base field names when Desktop returns aggregated captions', async () => {
    const harness = await startHarness((server) => {
      server.setOverride('GET /v0/workbook/worksheets/sheet-sales/summaryData', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          columns: [
            { name: 'Region', dataType: 'string' },
            { name: 'SUM(Profit)', dataType: 'real' },
            { name: 'SUM(Sales)', dataType: 'real' },
          ],
          rows: [['West', 240, 1200]],
        }),
      });
    });

    try {
      const result = await harness.callTool({
        worksheet: 'Sales by Region',
        columns: ['Region', 'Profit'],
      });

      expect(result.isError).toBe(false);
      expect(parseResult(result).summaryData).toEqual({
        columns: [
          { name: 'Region', dataType: 'string' },
          { name: 'SUM(Profit)', dataType: 'real' },
        ],
        rows: [['West', 240]],
      });
    } finally {
      await harness.close();
    }
  });

  it('returns an actionable error when Desktop ignores an invalid requested column', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({
        worksheet: 'Sales by Region',
        columns: ['Region', 'Not A Real Field'],
      });

      expect(result.isError).toBe(true);
      expect(parseJsonResult(result)).toMatchObject({
        status: 'action-required',
        reason: 'columns-not-found',
        guidance:
          'Use exact column names returned by this worksheet, or omit columns to retrieve the full summary table.',
        error: {
          message: expect.stringContaining('Available columns: Region, Sales, Profit'),
        },
      });
      expectStructuredBlock(result, {
        label: 'Repair summary columns and retry',
        kind: 'prefill',
      });
    } finally {
      await harness.close();
    }
  });

  it('returns an actionable error when an exact caption identifies multiple columns', async () => {
    const harness = await startHarness((server) => {
      server.setOverride('GET /v0/workbook/worksheets/sheet-sales/summaryData', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          columns: [
            { name: 'Region', dataType: 'string' },
            { name: 'SUM(Sales)', dataType: 'real' },
            { name: 'SUM(Sales)', dataType: 'real' },
          ],
          rows: [['West', 1200, 1200]],
        }),
      });
    });

    try {
      const result = await harness.callTool({
        worksheet: 'Sales by Region',
        columns: ['SUM(Sales)'],
      });

      expect(result.isError).toBe(true);
      expect(parseJsonResult(result)).toMatchObject({
        status: 'action-required',
        reason: 'columns-not-found',
        error: {
          message: expect.stringContaining(
            'Requested summary column "SUM(Sales)" matches more than one returned column',
          ),
        },
      });
    } finally {
      await harness.close();
    }
  });

  it('requires action without querying a worksheet that has no datasource', async () => {
    const harness = await startHarness((server) => {
      server.setOverride('GET /v0/workbook/worksheets', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          worksheets: [
            {
              id: 'sheet-empty',
              name: 'Empty Sheet',
              hidden: false,
              isActiveSheet: false,
              datasources: [],
            },
          ],
        }),
      });
    });

    try {
      const result = await harness.callTool({ worksheetName: 'Empty Sheet' });

      expect(result.isError).toBe(false);
      expect(parseJsonResult(result)).toEqual({
        status: 'action-required',
        reason: 'empty-sheet',
        worksheet: { id: 'sheet-empty', name: 'Empty Sheet' },
        maxRows: 200,
        shape: '0 rows x 0 columns',
        summaryData: { columns: [], rows: [] },
        guidance:
          'Desktop returned no summary columns for this sheet. Do NOT call get-summary-data again for this ask — name a sheet with fields on the view, or build and apply one first.',
      });
      expectStructuredBlock(result, {
        label: 'List templates, build a chart, then apply it',
        kind: 'prefill',
      });
      expect(harness.server.requests.some((request) => request.path.endsWith('/summaryData'))).toBe(
        false,
      );
    } finally {
      await harness.close();
    }
  });

  it('requires action when the worksheet has no marks', async () => {
    const harness = await startHarness((server) => {
      server.setOverride('GET /v0/workbook/worksheets/sheet-sales/summaryData', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ columns: [], rows: [] }),
      });
    });

    try {
      const result = await harness.callTool({ worksheetName: 'Sales by Region' });

      expect(result.isError).toBe(false);
      expect(parseJsonResult(result)).toMatchObject({
        status: 'action-required',
        reason: 'empty-sheet',
        shape: '0 rows x 0 columns',
        summaryData: { columns: [], rows: [] },
        guidance:
          'Desktop returned no summary columns for this sheet. Do NOT call get-summary-data again for this ask — name a sheet with fields on the view, or build and apply one first.',
      });
      expect(result.structuredContent).toMatchObject({
        nextAction: {
          label: 'List templates, build a chart, then apply it',
          kind: 'prefill',
        },
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
      const result = await harness.callTool({ worksheetName: 'Sales by Region' });

      expect(result.isError).toBe(false);
      expect(parseJsonResult(result)).toMatchObject({
        status: 'terminal',
        reason: 'no-rows',
        shape: '0 rows x 1 columns',
        summaryData: { columns: [{ name: 'Sales', dataType: 'real' }], rows: [] },
        guidance:
          "The summary query returned no rows. Do NOT call get-summary-data again for this ask — the answer is 'no data'; say so.",
      });
      expectStructuredBlock(result, {
        label: 'Data retrieval complete — no further calls needed',
        kind: 'done',
        receipt: {
          did: [
            'queried summary data for worksheet "Sales by Region" (maxRows 200)',
            'the sheet returned 1 column(s) and 0 rows',
          ],
          didNot: ['return any data values — there were none to return'],
          unverified: [expect.stringContaining('why the result is empty')],
        },
      });
    } finally {
      await harness.close();
    }
  });

  it('accepts the deprecated worksheet alias key and rejects a conflict with worksheetName', async () => {
    const harness = await startHarness();
    try {
      const aliased = await harness.callTool({ worksheet: 'Sales by Region' });
      expect(aliased.isError).toBe(false);
      expect(parseResult(aliased).worksheet).toEqual({
        id: 'sheet-sales',
        name: 'Sales by Region',
      });

      const conflict = await harness.callTool({
        worksheetName: 'Sales by Region',
        worksheet: 'Profit by Category',
      });
      expect(conflict.isError).toBe(true);
      invariant(conflict.content[0].type === 'text');
      expect(conflict.content[0].text).toContain('worksheetName ("Sales by Region")');
      expect(conflict.content[0].text).toContain('Pass one of them.');
    } finally {
      await harness.close();
    }
  });

  it('counts an alias call against the same transient-failure signature as a named call', async () => {
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
      const first = await harness.callTool({ worksheetName: 'Sales by Region', maxRows: 50 });
      const second = await harness.callTool({ worksheet: 'Sales by Region', maxRows: 50 });

      expect(parseJsonResult(first)).toMatchObject({
        status: 'retryable',
        reason: 'request-failed',
      });
      // The alias resolves to the same signature, so the repeat escalates to terminal.
      expect(parseJsonResult(second)).toMatchObject({
        status: 'terminal',
        reason: 'request-failed',
        guidance: expect.stringContaining('still failing — report the outcome; do not call again'),
      });
      expectStructuredBlock(second, TERMINAL_FAILURE_NEXT_ACTION);
    } finally {
      await harness.close();
    }
  });

  it('does not replay a prior success payload for repeated calls', async () => {
    const harness = await startHarness();
    try {
      const args = {
        worksheetName: 'Sales by Region',
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
          worksheets: [
            {
              id: 'sheet-empty',
              name: 'Empty Sheet',
              hidden: false,
              isActiveSheet: false,
              datasources: [],
            },
          ],
        }),
      });
    });

    try {
      const args = { worksheetName: 'Empty Sheet' };
      const first = await harness.callTool(args);
      const repeated = await harness.callTool(args);
      const firstBody = parseJsonResult(first) as Record<string, unknown>;

      expect(parseJsonResult(repeated)).toEqual({
        ...firstBody,
        guidance:
          'Desktop returned no summary columns for this sheet. Do NOT call get-summary-data again for this ask — name a sheet with fields on the view, or build and apply one first.',
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
      const args = { worksheetName: 'Sales by Region', columns: ['Region'] };
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
      const result = await harness.callTool({ worksheetName: 'Sales by Region' });

      expect(result.isError).toBe(true);
      expect(parseJsonResult(result)).toMatchObject({
        status: 'retryable',
        reason: 'request-failed',
        guidance: expect.stringContaining('transient — one retry is reasonable'),
        error: { type: 'desktop-command-execution-error' },
      });
      expectStructuredBlock(result, { label: 'Retry get-summary-data once', kind: 'prefill' });

      harness.server.setOverride('GET /v0/workbook/worksheets/sheet-sales/summaryData', undefined);
      const retry = await harness.callTool({ worksheetName: 'Sales by Region' });
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
      const first = await harness.callTool({ worksheetName: 'Sales by Region', maxRows: 50 });
      const second = await harness.callTool({ worksheetName: 'Sales by Region', maxRows: 50 });

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
      expectStructuredBlock(second, TERMINAL_FAILURE_NEXT_ACTION);
    } finally {
      await harness.close();
    }
  });

  it('passes an explicit session to the session resolver', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ session: 'desktop-2', worksheetName: 'sheet-sales' });

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
      const failed = await harness.callTool({ worksheetName: 'Sales by Region' });

      expect(failed.isError).toBe(true);
      expect(parseJsonResult(failed)).toMatchObject({
        status: 'retryable',
        reason: 'session-resolution-failed',
        guidance: expect.stringContaining('transient — one retry is reasonable'),
      });

      const retry = await harness.callTool({ worksheetName: 'Sales by Region' });
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
      const firstFailure = await harness.callTool({
        worksheetName: 'Sales by Region',
        maxRows: 50,
      });
      const success = await harness.callTool({ worksheetName: 'Sales by Region', maxRows: 50 });
      vi.mocked(sessionResolution.resolveSession).mockReturnValueOnce(
        new ArgsValidationError('Desktop discovery temporarily unavailable').toErr(),
      );
      const nextFailure = await harness.callTool({ worksheetName: 'Sales by Region', maxRows: 50 });

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
      expectStructuredBlock(nextFailure, {
        label: 'Retry get-summary-data once',
        kind: 'prefill',
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
      const first = await harness.callTool({ worksheetName: 'Sales by Region', maxRows: 50 });
      const second = await harness.callTool({ worksheetName: 'Sales by Region', maxRows: 50 });

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
      expectStructuredBlock(second, TERMINAL_FAILURE_NEXT_ACTION);
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
        worksheetName: 'Sales by Region',
        maxRows: 50,
      });
      const sessionB = await harness.callTool({
        session: 'desktop-b',
        worksheetName: 'Sales by Region',
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
      expectStructuredBlock(sessionB, { label: 'Retry get-summary-data once', kind: 'prefill' });
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
      const first = await harness.callTool({ worksheetName: 'Sales by Region', maxRows: 50 });
      const second = await harness.callTool({ worksheetName: 'Sales by Region', maxRows: 50 });

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
      expectStructuredBlock(second, TERMINAL_FAILURE_NEXT_ACTION);
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
        worksheetName: 'Sales by Region',
        maxRows: 50,
      });
      const resolvedTransportFailure = await harness.callTool({
        worksheetName: 'Sales by Region',
        maxRows: 50,
      });
      const secondResolvedTransportFailure = await harness.callTool({
        worksheetName: 'Sales by Region',
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
          worksheets: [
            { id: 'sheet-only', name: 'Only Sheet', hidden: false, isActiveSheet: true },
          ],
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
            { id: 'sheet-a', name: 'Regional Sales', hidden: false, isActiveSheet: false },
            { id: 'sheet-b', name: 'Regional Sales', hidden: false, isActiveSheet: false },
          ],
        }),
      });
    });

    try {
      const result = await harness.callTool({ worksheetName: 'Regional Sales' });

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
      const result = await harness.callTool({ worksheetName: 'Missing Sheet' });

      expect(result.isError).toBe(true);
      expect(parseJsonResult(result)).toMatchObject({
        status: 'action-required',
        reason: 'worksheet-not-found',
        guidance:
          'The requested worksheet was not found. Choose an available populated worksheet, correct the worksheet name/id, or use list-templates, build-worksheets-from-templates, and apply-worksheet before calling get-summary-data again.',
        error: {
          message: expect.stringMatching(
            /Worksheet "Missing Sheet" was not found.*Sales by Region.*Profit by Category/,
          ),
        },
      });
      expectStructuredBlock(result, {
        label: 'Repair worksheet selection and retry',
        kind: 'prefill',
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
      const result = await harness.callTool({ worksheetName: 'Sales by Region' });

      expect(result.isError).toBe(true);
      expect(parseJsonResult(result)).toMatchObject({
        status: 'action-required',
        reason: 'endpoint-unavailable',
        guidance: expect.stringContaining('Desktop build'),
      });
      expectStructuredBlock(result, { label: 'Update Desktop/API and retry', kind: 'prefill' });
    } finally {
      await harness.close();
    }
  });

  it('clamps maxRows to 1000 before querying summary data', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ worksheetName: 'sheet-sales', maxRows: 5000 });

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
          worksheetName: args.worksheetName,
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

/**
 * The block a client actually receives is the JSON body PLUS the nextAction envelope. A
 * client that prefers structuredContent drops the text block outright, so asserting the
 * body is folded in is asserting the agent still learns the status, the reason and the
 * guidance — not just "what to do next".
 */
function expectStructuredBlock(result: CallToolResult, nextAction: unknown): void {
  expect(result.structuredContent).toEqual({
    ...(parseJsonResult(result) as object),
    nextAction,
  });
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
