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
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('creates a data-first tool with the expected public args', () => {
    const tool = getSummaryDataTool(new DesktopMcpServer());

    expect(tool.name).toBe('get-summary-data');
    expect(tool.description).toContain('Read the ACTUAL data behind a worksheet');
    expect(tool.description).toContain('Detail on the marks card');
    expect(tool.description).toContain('FIRST PLAY');
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

  it('errors with worksheet names when worksheet is omitted but ambiguous', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({});

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Multiple worksheets exist');
      expect(result.content[0].text).toContain('Sales by Region');
      expect(result.content[0].text).toContain('Profit by Category');
    } finally {
      await harness.close();
    }
  });

  it('errors with matching worksheet names when worksheet name is ambiguous', async () => {
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
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('matched multiple worksheets');
      expect(result.content[0].text).toContain('sheet-a');
      expect(result.content[0].text).toContain('sheet-b');
    } finally {
      await harness.close();
    }
  });

  it('errors with available worksheet names when worksheet is not found', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ worksheet: 'Missing Sheet' });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Worksheet "Missing Sheet" was not found');
      expect(result.content[0].text).toContain('Sales by Region');
      expect(result.content[0].text).toContain('Profit by Category');
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
  invariant(result.content[0].type === 'text');
  return resultSchema.parse(JSON.parse(result.content[0].text));
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
