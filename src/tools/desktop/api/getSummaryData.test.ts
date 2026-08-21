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
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { UnknownError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getSummaryDataTool } from './getSummaryData.js';
import { fetchWorksheetSummaryData, type SummaryDataRead } from './summaryDataCore.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const resultSchema = z.object({
  worksheet: z.object({ id: z.string(), name: z.string() }),
  maxRows: z.number(),
  rowOrder: z.object({
    status: z.literal('unspecified'),
    usableFor: z.literal('value_readback'),
    notUsableFor: z.literal('visual_sort_verification'),
  }),
  shape: z.string(),
  summaryData: z.object({
    columns: z.array(z.object({ name: z.string().optional(), dataType: z.string().optional() })),
    rows: z.array(z.array(z.unknown())),
  }),
});

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
  it('preserves endpoint row order and labels it unspecified', async () => {
    const endpointRows = [
      ['Middle', 20],
      ['Largest', 90],
      ['Smallest', 10],
    ];
    const read = (async (endpoint: string) => {
      if (endpoint === 'worksheet list') {
        return Ok({
          worksheets: [
            {
              id: 'sheet-sales',
              name: 'Sales by Region',
              hidden: false,
              datasources: ['Superstore'],
            },
          ],
        });
      }
      return Ok({
        columns: [{ name: 'Region' }, { name: 'SUM(Sales)' }],
        rows: endpointRows,
      });
    }) as SummaryDataRead;

    const result = await fetchWorksheetSummaryData({
      read,
      worksheet: 'Sales by Region',
      maxRows: 10,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw result.error;
    expect(result.value.rows).toEqual(endpointRows);
    expect(result.value.rowOrder).toEqual({
      status: 'unspecified',
      usableFor: 'value_readback',
      notUsableFor: 'visual_sort_verification',
    });
  });

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

  // The projection has two duplicate-caption guards; a first-match "simplification" of either
  // would silently project the wrong column. Both branches must error, not pick the first.
  it('rejects a requested column that exactly matches more than one returned column', async () => {
    const read = summaryReadReturning({
      columns: [{ name: 'SUM(Sales)' }, { name: 'SUM(Sales)' }],
      rows: [[1200, 900]],
    });

    const result = await fetchWorksheetSummaryData({
      read,
      worksheet: 'Sales by Region',
      maxRows: 200,
      columns: ['SUM(Sales)'],
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) throw new Error('expected a duplicate-column error');
    expect(result.error.type).toBe('columns');
    expect(result.error.error.message).toContain('matches more than one returned column');
    expect(result.error.error.message).toContain('SUM(Sales), SUM(Sales)');
  });

  it('rejects a base field name that normalizes to more than one returned column', async () => {
    // Neither returned caption equals "Sales" exactly, so the exact-match branch is skipped and
    // the normalized branch decides: both SUM(Sales) and AGG(Sales) normalize to "sales".
    const read = summaryReadReturning({
      columns: [{ name: 'SUM(Sales)' }, { name: 'AGG(Sales)' }],
      rows: [[1200, 900]],
    });

    const result = await fetchWorksheetSummaryData({
      read,
      worksheet: 'Sales by Region',
      maxRows: 200,
      columns: ['Sales'],
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) throw new Error('expected a duplicate-column error');
    expect(result.error.type).toBe('columns');
    expect(result.error.error.message).toContain('matches more than one returned column');
    expect(result.error.error.message).toContain('SUM(Sales), AGG(Sales)');
  });
});

// A minimal read that resolves the sole worksheet and returns the given summary payload, for
// exercising fetchWorksheetSummaryData's projection without the mock HTTP harness.
function summaryReadReturning(summary: { columns: unknown[]; rows: unknown[][] }): SummaryDataRead {
  return (async (endpoint: string) => {
    if (endpoint === 'worksheet list') {
      return Ok({
        worksheets: [
          {
            id: 'sheet-sales',
            name: 'Sales by Region',
            hidden: false,
            datasources: ['Sample - Superstore'],
          },
        ],
      });
    }
    return Ok(summary);
  }) as SummaryDataRead;
}

describe('getSummaryDataTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('describes an aggregated summary read of the fields on the view', () => {
    const tool = getSummaryDataTool(new DesktopMcpServer());

    expect(tool.name).toBe('get-summary-data');
    expect(tool.description).toBe(
      'Read the aggregated summary rows on a populated worksheet (only the fields on the view).',
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
      expect(body.worksheet).toEqual({ id: 'sheet-sales', name: 'Sales by Region' });
      expect(body.maxRows).toBe(50);
      expect(body.rowOrder).toEqual({
        status: 'unspecified',
        usableFor: 'value_readback',
        notUsableFor: 'visual_sort_verification',
      });
      expect(body.shape).toBe('2 rows x 2 columns');
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

  it('surfaces a raw column error when a requested column is not returned', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({
        worksheet: 'Sales by Region',
        columns: ['Region', 'Not A Real Field'],
      });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain('Available columns: Region, Sales, Profit');
    } finally {
      await harness.close();
    }
  });

  it('returns aggregated data with no datasource as an empty summary, without querying', async () => {
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
      expect(parseResult(result)).toMatchObject({
        worksheet: { id: 'sheet-empty', name: 'Empty Sheet' },
        maxRows: 200,
        shape: '0 rows x 0 columns',
        rowOrder: {
          status: 'unspecified',
          usableFor: 'value_readback',
          notUsableFor: 'visual_sort_verification',
        },
        summaryData: { columns: [], rows: [] },
      });
      expect(harness.server.requests.some((request) => request.path.endsWith('/summaryData'))).toBe(
        false,
      );
    } finally {
      await harness.close();
    }
  });

  it('returns an empty summary when the worksheet has no marks', async () => {
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
      expect(parseResult(result)).toMatchObject({
        shape: '0 rows x 0 columns',
        summaryData: { columns: [], rows: [] },
      });
    } finally {
      await harness.close();
    }
  });

  it('returns the columns and zero rows when a populated worksheet query has no rows', async () => {
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
      expect(parseResult(result)).toMatchObject({
        shape: '0 rows x 1 columns',
        rowOrder: {
          status: 'unspecified',
          usableFor: 'value_readback',
          notUsableFor: 'visual_sort_verification',
        },
        summaryData: { columns: [{ name: 'Sales', dataType: 'real' }], rows: [] },
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

  it('surfaces a raw request error when the summary query fails', async () => {
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
      // The raw executor message reaches the caller so it can read the reason, not a bare status.
      expect(errorText(result)).toContain('Could not query worksheet');
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

  it('surfaces a raw error when worksheet is omitted but ambiguous', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({});

      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain('Multiple worksheets exist');
    } finally {
      await harness.close();
    }
  });

  it('surfaces a raw error when worksheet name is ambiguous', async () => {
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
      expect(errorText(result)).toMatch(/matched multiple worksheets.*sheet-a.*sheet-b/);
    } finally {
      await harness.close();
    }
  });

  it('surfaces a raw error when the worksheet is not found', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ worksheetName: 'Missing Sheet' });

      expect(result.isError).toBe(true);
      expect(errorText(result)).toMatch(
        /Worksheet "Missing Sheet" was not found.*Sales by Region.*Profit by Category/,
      );
    } finally {
      await harness.close();
    }
  });

  it('tells the caller the Desktop build is too old when the summary-data route is missing', async () => {
    // The tool dropped its own endpoint-unavailable status, but the shared read harness still
    // maps a missing route to the actionable "build is too old, do not retry" message, so a
    // build-too-old read stays diagnosable without the removed status machine.
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
      expect(errorText(result)).toContain('Desktop build');
      expect(errorText(result)).toContain('Do not retry');
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

// The clean wrapper surfaces a failure as the executor's raw error text, so a caller reads
// the reason straight from the message rather than from a status/guidance envelope.
function errorText(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return result.content[0].text;
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
