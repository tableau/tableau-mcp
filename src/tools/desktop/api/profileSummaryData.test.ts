import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { ExecuteCommandError } from '../../../desktop/externalApi/executorTypes.js';
import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import * as readHarness from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getProfileSummaryDataTool } from './profileSummaryData.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const worksheet = {
  id: 'sheet-1',
  name: 'Sales by Category',
  hidden: false,
  datasources: ['Sample - Superstore'],
};
type SummaryFixture = { columns: Array<Record<string, unknown>>; rows: unknown[][] };

const baseData: SummaryFixture = {
  columns: [{ name: 'Category' }, { name: 'SUM(Sales)' }],
  rows: [
    ['Furniture', 100],
    ['Technology', 200],
  ],
};

describe('getProfileSummaryDataTool', () => {
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('resolved-42'));
    nowSpy = vi.spyOn(performance, 'now');
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('declares a bounded read-only profiling contract', async () => {
    const tool = getProfileSummaryDataTool(new DesktopMcpServer());
    const schema = z.object(await Provider.from(tool.paramsSchema));

    expect(tool.name).toBe('profile-summary-data');
    expect(tool.description).toContain('not worksheet render time');
    expect(tool.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(schema.safeParse({ worksheetName: 'Sheet 1', sampleCount: 1 }).success).toBe(false);
    expect(schema.safeParse({ worksheetName: 'Sheet 1', sampleCount: 11 }).success).toBe(false);
    expect(schema.safeParse({ worksheetName: '' }).success).toBe(false);
  });

  it('resolves one exact worksheet and runs sequential summary requests with stable statistics', async () => {
    mockDurations([10, 20, 30, 40, 50]);
    const harness = makeHarness([baseData, baseData, baseData, baseData, baseData]);
    const readToolSpy = vi.spyOn(readHarness, 'runExternalApiReadTool');

    const result = await harness.callTool({
      session: '42',
      worksheetName: worksheet.name,
    });

    expect(result.isError).toBe(false);
    const body = parseResult(result);
    expect(body).toMatchObject({
      status: 'success',
      session: 'resolved-42',
      worksheet: { id: 'sheet-1', name: 'Sales by Category' },
      sampleCount: 5,
      maxRows: 200,
      measurement:
        'Summary-data API query/compute round trip proxy; excludes worksheet resolution and worksheet render time.',
      statistics: {
        medianDurationMs: 30,
        minDurationMs: 10,
        maxDurationMs: 50,
        spreadDurationMs: 40,
      },
      resultsStable: true,
    });
    expect(body.samples.map((sample) => sample.durationMs)).toEqual([10, 20, 30, 40, 50]);
    expect(body.samples.map((sample) => [sample.rowCount, sample.columnCount])).toEqual([
      [2, 2],
      [2, 2],
      [2, 2],
      [2, 2],
      [2, 2],
    ]);
    expect(body.stableResultFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(readToolSpy).toHaveBeenCalledTimes(1);
    expect(sessionResolution.resolveSession).toHaveBeenCalledWith('42');
    expect(harness.getExecutor).toHaveBeenCalledWith('resolved-42');
    expect(harness.executor.listWorksheets).toHaveBeenCalledTimes(1);
    expect(harness.executor.getWorksheetSummaryData).toHaveBeenCalledTimes(5);
    for (const call of harness.executor.getWorksheetSummaryData.mock.calls) {
      expect(call[0]).toBe('sheet-1');
      expect(call[1]).toEqual({ maxRows: 200, ignoreSelection: true });
      expect(call[2]).toBeInstanceOf(AbortSignal);
    }
    expect(harness.executor.exportWorksheetImage).not.toHaveBeenCalled();
  });

  it('uses the average of the two middle samples for an even median and clamps maxRows', async () => {
    mockDurations([40, 10, 30, 20]);
    const harness = makeHarness([baseData, baseData, baseData, baseData]);

    const result = await harness.callTool({
      worksheetName: worksheet.name,
      sampleCount: 4,
      maxRows: 5000,
    });

    const body = parseResult(result);
    expect(body.maxRows).toBe(1000);
    expect(body.statistics).toEqual({
      medianDurationMs: 25,
      minDurationMs: 10,
      maxDurationMs: 40,
      spreadDurationMs: 30,
    });
    expect(harness.executor.getWorksheetSummaryData).toHaveBeenCalledTimes(4);
    expect(harness.executor.getWorksheetSummaryData.mock.calls[0][1]).toEqual({
      maxRows: 1000,
      ignoreSelection: true,
    });
  });

  it('canonicalizes object keys recursively while preserving array order', async () => {
    mockDurations([1, 2]);
    const harness = makeHarness([
      {
        columns: [{ name: 'Sales', metadata: { z: 2, a: 1 } }],
        rows: [[{ b: 2, a: 1 }, 100]],
      },
      {
        columns: [{ metadata: { a: 1, z: 2 }, name: 'Sales' }],
        rows: [[{ a: 1, b: 2 }, 100]],
      },
    ]);

    const body = parseResult(
      await harness.callTool({ worksheetName: worksheet.name, sampleCount: 2 }),
    );

    expect(body.resultsStable).toBe(true);
    expect(body.stableResultFingerprint).toBe(
      '8cb55e4061f317ed1fcb62672725b1268edfa7b774da0e2b3398679f99d90e17',
    );
    expect(body.samples[0].resultFingerprint).toBe(body.samples[1].resultFingerprint);
  });

  it('reports instability when returned values or array order changes', async () => {
    mockDurations([1, 2, 3]);
    const harness = makeHarness([
      baseData,
      { ...baseData, rows: [...baseData.rows].reverse() },
      { ...baseData, rows: [['Furniture', 101]] },
    ]);

    const body = parseResult(
      await harness.callTool({ worksheetName: worksheet.name, sampleCount: 3 }),
    );

    expect(body.resultsStable).toBe(false);
    expect(body.status).toBe('unstable_results');
    expect(body.stableResultFingerprint).toBeNull();
    expect(new Set(body.samples.map((sample) => sample.resultFingerprint)).size).toBe(3);
  });

  it.each([
    ['no datasource', { ...worksheet, datasources: [] }, baseData, 'has no datasource'],
    ['no columns', worksheet, { columns: [], rows: [] }, 'returned no columns'],
    ['no rows', worksheet, { columns: [{ name: 'Sales' }], rows: [] }, 'returned no rows'],
  ])('fails before producing a misleading profile for %s', async (_label, sheet, data, message) => {
    mockDurations([1, 2]);
    const harness = makeHarness([data, data], sheet);

    const result = await harness.callTool({ worksheetName: sheet.name, sampleCount: 2 });

    expect(result.isError).toBe(true);
    expect(textResult(result)).toContain(message);
    expect(harness.executor.exportWorksheetImage).not.toHaveBeenCalled();
  });

  it('fails fast on a partial summary error', async () => {
    mockDurations([1, 2, 3]);
    const failure: ExecuteCommandError = {
      type: 'command-failed',
      error: { code: 'query-failed', message: 'query failed', recoverable: false },
    };
    const harness = makeHarness([baseData, failure, baseData]);

    const result = await harness.callTool({ worksheetName: worksheet.name, sampleCount: 3 });

    expect(result.isError).toBe(true);
    expect(harness.executor.getWorksheetSummaryData).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'missing route',
      {
        type: 'command-failed',
        error: {
          code: 'not-found',
          message: 'No route matches the request path.',
          recoverable: false,
        },
      } satisfies ExecuteCommandError,
      'does not serve the summary-data endpoint',
    ],
    [
      'abort',
      {
        type: 'command-timed-out',
        error: 'External Client API request was aborted before completion.',
      } satisfies ExecuteCommandError,
      'aborted',
    ],
  ])(
    'returns an error and stops after the first sample on %s',
    async (_label, failure, message) => {
      mockDurations([1, 2]);
      const harness = makeHarness([failure, baseData]);

      const result = await harness.callTool({ worksheetName: worksheet.name, sampleCount: 2 });

      expect(result.isError).toBe(true);
      expect(textResult(result).toLowerCase()).toContain(message);
      expect(harness.executor.getWorksheetSummaryData).toHaveBeenCalledTimes(1);
    },
  );
});

type ProfileArgs = {
  session?: string;
  worksheetName: string;
  sampleCount?: number;
  maxRows?: number;
};

type ProfileBody = {
  status: 'success' | 'unstable_results';
  session: string;
  worksheet: { id: string; name: string };
  sampleCount: number;
  maxRows: number;
  measurement: string;
  samples: Array<{
    index: number;
    durationMs: number;
    rowCount: number;
    columnCount: number;
    resultFingerprint: string;
  }>;
  statistics: {
    medianDurationMs: number;
    minDurationMs: number;
    maxDurationMs: number;
    spreadDurationMs: number;
  };
  resultsStable: boolean;
  stableResultFingerprint: string | null;
};

function makeHarness(
  responses: Array<SummaryFixture | ExecuteCommandError>,
  targetWorksheet = worksheet,
): {
  executor: {
    listWorksheets: ReturnType<typeof vi.fn>;
    getWorksheetSummaryData: ReturnType<typeof vi.fn>;
    exportWorksheetImage: ReturnType<typeof vi.fn>;
  };
  getExecutor: ReturnType<typeof vi.fn>;
  callTool: (args: ProfileArgs) => Promise<CallToolResult>;
} {
  const queue = [...responses];
  const executor = {
    listWorksheets: vi.fn().mockResolvedValue(Ok({ worksheets: [targetWorksheet] })),
    getWorksheetSummaryData: vi.fn().mockImplementation(async () => {
      const response = queue.shift();
      invariant(response !== undefined);
      return 'type' in response ? Err(response) : Ok(response);
    }),
    exportWorksheetImage: vi.fn(),
  };
  const getExecutor = vi.fn().mockResolvedValue(executor as unknown as ExternalApiToolExecutor);
  const extra = { ...getMockRequestHandlerExtra(), getExecutor };

  return {
    executor,
    getExecutor,
    callTool: async (args) => {
      const tool = getProfileSummaryDataTool(new DesktopMcpServer());
      const callback = await Provider.from(tool.callback);
      return await callback(
        {
          session: args.session,
          worksheetName: args.worksheetName,
          sampleCount: args.sampleCount,
          maxRows: args.maxRows,
        },
        extra,
      );
    },
  };
}

function mockDurations(durations: number[]): void {
  const values = [0];
  let cursor = 10;
  for (const duration of durations) {
    values.push(cursor, cursor + duration);
    cursor += duration + 10;
  }
  values.push(cursor);
  vi.spyOn(performance, 'now').mockImplementation(() => values.shift() ?? cursor);
}

function parseResult(result: CallToolResult): ProfileBody {
  return JSON.parse(textResult(result)) as ProfileBody;
}

function textResult(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return result.content[0].text;
}
