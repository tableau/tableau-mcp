import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { withApplyLock } from '../../../desktop/wrappers/applyMutex.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { DesktopTool } from '../tool.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getDeleteSheetTool } from './deleteSheet.js';
import { getWorksheetUnderlyingDataTool } from './getWorksheetUnderlyingData.js';
import { getListWorksheetLogicalTablesTool } from './listWorksheetLogicalTables.js';
import { getRenameSheetTool } from './renameSheet.js';
import { getSortWorksheetTool } from './sortWorksheet.js';

vi.mock('../../../desktop/session/sessionResolution.js');

// Seeded by mockExternalApiServer.
const WORKSHEET_ID = 'sheet-sales';
const WORKSHEET_NAME = 'Sales by Region';
const DASHBOARD_NAME = 'Executive Dashboard';
const DASHBOARD_ID = 'dash-exec';
const LOGICAL_TABLE_ID = 'lt-orders';

describe('delete-sheet / rename-sheet / sort-worksheet + logical-table read tools', () => {
  it('defines descending numeric sort in plain language', async () => {
    const tool = getSortWorksheetTool(new DesktopMcpServer());
    const paramsSchema = await Provider.from(tool.paramsSchema);
    expect(paramsSchema.direction.description).toContain('Numeric desc: largest first');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('delete-sheet POSTs the worksheet :delete route body-less', async () => {
    const harness = await startHarness(getDeleteSheetTool);
    try {
      const { result } = await run(harness, { sheet: WORKSHEET_NAME });
      expect(result.isError).toBeFalsy();
      const posted = harness.server.requests.filter(
        (r) => r.method === 'POST' && r.path === `/v0/workbook/worksheets/${WORKSHEET_ID}:delete`,
      );
      expect(posted).toHaveLength(1);
      expect(posted[0].body).toBe('');
    } finally {
      await harness.close();
    }
  });

  it('delete-sheet routes a dashboard target to the dashboards :delete path', async () => {
    const harness = await startHarness(getDeleteSheetTool);
    try {
      const { result } = await run(harness, { sheet: DASHBOARD_NAME });
      expect(result.isError).toBeFalsy();
      const posted = harness.server.requests.filter(
        (r) => r.method === 'POST' && r.path === `/v0/workbook/dashboards/${DASHBOARD_ID}:delete`,
      );
      expect(posted).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it('delete-sheet waits for an in-flight apply before POSTing its mutation', async () => {
    await expectMutationWaitsForApplyLock(
      getDeleteSheetTool,
      { sheet: WORKSHEET_NAME },
      `/v0/workbook/worksheets/${WORKSHEET_ID}:delete`,
    );
  });

  it('rename-sheet POSTs the worksheet :rename route with the new name', async () => {
    const harness = await startHarness(getRenameSheetTool);
    try {
      const { result } = await run(harness, { sheet: WORKSHEET_NAME, name: 'Regional Sales' });
      expect(result.isError).toBeFalsy();
      const posted = harness.server.requests.filter(
        (r) => r.method === 'POST' && r.path === `/v0/workbook/worksheets/${WORKSHEET_ID}:rename`,
      );
      expect(posted).toHaveLength(1);
      expect(JSON.parse(posted[0].body)).toEqual({ name: 'Regional Sales' });
    } finally {
      await harness.close();
    }
  });

  it('rename-sheet waits for an in-flight apply before POSTing its mutation', async () => {
    await expectMutationWaitsForApplyLock(
      getRenameSheetTool,
      { sheet: WORKSHEET_NAME, name: 'Regional Sales' },
      `/v0/workbook/worksheets/${WORKSHEET_ID}:rename`,
    );
  });

  it('serializes worksheet resolution with deletion so concurrent deletes keep one worksheet', async () => {
    let worksheets = [
      { id: 'sheet-a', name: 'Worksheet A' },
      { id: 'sheet-b', name: 'Worksheet B' },
    ];
    const listWorksheets = vi.fn(async () => new Ok({ worksheets: [...worksheets] }));
    let markFirstDeleteStarted!: () => void;
    const firstDeleteStarted = new Promise<void>((resolve) => {
      markFirstDeleteStarted = resolve;
    });
    let releaseFirstDelete!: () => void;
    const firstDeleteReleased = new Promise<void>((resolve) => {
      releaseFirstDelete = resolve;
    });
    const deleteSheet = vi.fn(async (ref: { id: string }) => {
      if (ref.id === 'sheet-a') {
        markFirstDeleteStarted();
        await firstDeleteReleased;
      }
      worksheets = worksheets.filter(({ id }) => id !== ref.id);
      return new Ok({ command_id: 'delete-sheet', status: 'completed' as const, result: null });
    });
    const executor = {
      listWorksheets,
      listDashboards: vi.fn().mockResolvedValue(new Ok({ dashboards: [] })),
      listStoryboards: vi.fn().mockResolvedValue(new Ok({ storyboards: [] })),
      deleteSheet,
    };
    const callback = (await Provider.from(getDeleteSheetTool(new DesktopMcpServer()).callback)) as (
      args: Record<string, unknown>,
      extra: ReturnType<typeof getMockRequestHandlerExtra>,
    ) => Promise<CallToolResult>;
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(executor),
    };

    const first = callback({ sheet: 'Worksheet A' }, extra);
    await firstDeleteStarted;
    const second = callback({ sheet: 'Worksheet B' }, extra);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const listReadsWhileFirstDeleteWasBlocked = listWorksheets.mock.calls.length;
    releaseFirstDelete();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.isError).toBeFalsy();
    expect(secondResult.isError).toBeFalsy();
    invariant(secondResult.content[0].type === 'text');
    expect(secondResult.content[0].text).toContain('"deleted":false');
    expect(deleteSheet).toHaveBeenCalledTimes(1);
    expect(deleteSheet).toHaveBeenCalledWith(
      { id: 'sheet-a', kind: 'worksheet' },
      expect.any(AbortSignal),
    );
    expect(listReadsWhileFirstDeleteWasBlocked).toBe(1);
    expect(worksheets).toEqual([{ id: 'sheet-b', name: 'Worksheet B' }]);
  });

  it('sort-worksheet resolves a plain field name to its on-shelf token and POSTs :sort', async () => {
    const harness = await startHarness(getSortWorksheetTool);
    try {
      const { result } = await run(harness, {
        worksheet: WORKSHEET_NAME,
        fieldName: 'Sales',
        direction: 'desc',
        sortType: 'alpha',
      });
      expect(result.isError).toBeFalsy();
      const posted = harness.server.requests.filter(
        (r) => r.method === 'POST' && r.path === `/v0/workbook/worksheets/${WORKSHEET_ID}:sort`,
      );
      expect(posted).toHaveLength(1);
      expect(JSON.parse(posted[0].body)).toEqual({
        fieldName: '[Sample - Superstore].[sum:Sales:qk]',
        direction: 'desc',
        sortType: 'alpha',
      });
    } finally {
      await harness.close();
    }
  });

  it('sort-worksheet rejects a field that is not on the worksheet shelves, POSTing nothing', async () => {
    const harness = await startHarness(getSortWorksheetTool);
    try {
      const { result } = await run(harness, { worksheet: WORKSHEET_NAME, fieldName: 'Discount' });
      expect(result.isError).toBeTruthy();
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('not on worksheet');
      const posted = harness.server.requests.filter(
        (r) => r.method === 'POST' && r.path === `/v0/workbook/worksheets/${WORKSHEET_ID}:sort`,
      );
      expect(posted).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it('sort-worksheet rejects an ambiguous shelf field and lists each canonical candidate', async () => {
    const harness = await startHarness(getSortWorksheetTool);
    const salesSum = '[Sample - Superstore].[sum:Sales:qk]';
    const salesAvg = '[Sample - Superstore].[avg:Sales:qk]';
    harness.server.setOverride(`GET /v0/workbook/worksheets/${WORKSHEET_ID}/document`, {
      status: 200,
      contentType: 'application/xml',
      body:
        '<?xml version="1.0"?>' +
        '<worksheet name="Sales by Region"><table>' +
        '<rows>[Sample - Superstore].[none:Region:nk]</rows>' +
        `<cols>${salesSum} / ${salesAvg}</cols>` +
        '</table><simple-id uuid="sheet-sales" /></worksheet>',
    });
    try {
      const { result } = await run(harness, { worksheet: WORKSHEET_NAME, fieldName: 'Sales' });
      expect(result.isError).toBeTruthy();
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(salesSum);
      expect(result.content[0].text).toContain(salesAvg);
      const posted = harness.server.requests.filter(
        (r) => r.method === 'POST' && r.path === `/v0/workbook/worksheets/${WORKSHEET_ID}:sort`,
      );
      expect(posted).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it('list-worksheet-logical-tables GETs the logicalTables route and returns the tables', async () => {
    const harness = await startHarness(getListWorksheetLogicalTablesTool);
    try {
      const { result } = await run(harness, { worksheet: WORKSHEET_NAME });
      expect(result.isError).toBeFalsy();
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(LOGICAL_TABLE_ID);
      const got = harness.server.requests.filter(
        (r) =>
          r.method === 'GET' && r.path === `/v0/workbook/worksheets/${WORKSHEET_ID}/logicalTables`,
      );
      expect(got).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it('get-worksheet-underlying-data GETs the logical-table data route with query params', async () => {
    const harness = await startHarness(getWorksheetUnderlyingDataTool);
    try {
      const { result } = await run(harness, {
        worksheet: WORKSHEET_NAME,
        logicalTable: LOGICAL_TABLE_ID,
        maxRows: 50,
        includeAllColumns: true,
      });
      expect(result.isError).toBeFalsy();
      const got = harness.server.requests.filter(
        (r) =>
          r.method === 'GET' &&
          r.path.startsWith(
            `/v0/workbook/worksheets/${WORKSHEET_ID}/logicalTables/${LOGICAL_TABLE_ID}/data`,
          ),
      );
      expect(got).toHaveLength(1);
      expect(got[0].searchParams).toMatchObject({ maxRows: '50', includeAllColumns: 'true' });
    } finally {
      await harness.close();
    }
  });

  it('get-worksheet-underlying-data resolves a logical table caption to its id', async () => {
    const harness = await startHarness(getWorksheetUnderlyingDataTool);
    try {
      const { result } = await run(harness, {
        worksheet: WORKSHEET_NAME,
        logicalTable: 'Orders',
      });
      expect(result.isError).toBeFalsy();
      const got = harness.server.requests.filter(
        (r) =>
          r.method === 'GET' &&
          r.path.startsWith(
            `/v0/workbook/worksheets/${WORKSHEET_ID}/logicalTables/${LOGICAL_TABLE_ID}/data`,
          ),
      );
      expect(got).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it('get-worksheet-underlying-data qualifies a bare column name with the datasource caption', async () => {
    const harness = await startHarness(getWorksheetUnderlyingDataTool);
    try {
      const { result } = await run(harness, {
        worksheet: WORKSHEET_NAME,
        logicalTable: LOGICAL_TABLE_ID,
        columns: ['Sales'],
      });
      expect(result.isError).toBeFalsy();
      const got = harness.server.requests.filter(
        (r) =>
          r.method === 'GET' &&
          r.path.startsWith(
            `/v0/workbook/worksheets/${WORKSHEET_ID}/logicalTables/${LOGICAL_TABLE_ID}/data`,
          ),
      );
      expect(got).toHaveLength(1);
      expect(got[0].searchParams).toMatchObject({
        columnsToIncludeByFieldName: '[Sample - Superstore].[Sales]',
      });
    } finally {
      await harness.close();
    }
  });

  it('delete-sheet refuses to delete the last remaining worksheet without POSTing', async () => {
    const deleteSheet = vi.fn();
    const executor = {
      listWorksheets: vi
        .fn()
        .mockResolvedValue(Ok({ worksheets: [{ id: WORKSHEET_ID, name: WORKSHEET_NAME }] })),
      listDashboards: vi.fn().mockResolvedValue(Ok({ dashboards: [] })),
      listStoryboards: vi.fn().mockResolvedValue(Ok({ storyboards: [] })),
      deleteSheet,
    };
    const tool = getDeleteSheetTool(new DesktopMcpServer());
    const callback = (await Provider.from(tool.callback)) as (
      args: Record<string, unknown>,
      extra: ReturnType<typeof getMockRequestHandlerExtra>,
    ) => Promise<CallToolResult>;
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(executor),
    };

    const result = await callback({ sheet: WORKSHEET_NAME }, extra);

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('"deleted":false');
    expect(deleteSheet).not.toHaveBeenCalled();
  });
});

type Harness = {
  server: MockExternalApiServer;
  callTool: (args: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
};

async function run(
  harness: Harness,
  args: Record<string, unknown>,
): Promise<{ result: CallToolResult }> {
  return { result: await harness.callTool(args) };
}

async function startHarness(
  makeTool: (server: DesktopMcpServer) => DesktopTool<any>,
): Promise<Harness> {
  const server = await startMockExternalApiServer();
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = makeTool(new DesktopMcpServer());
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

async function expectMutationWaitsForApplyLock(
  makeTool: (server: DesktopMcpServer) => DesktopTool<any>,
  args: Record<string, unknown>,
  mutationPath: string,
): Promise<void> {
  let markLockHeld!: () => void;
  const lockHeld = new Promise<void>((resolve) => {
    markLockHeld = resolve;
  });
  let releaseLock!: () => void;
  const lockReleased = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  const blocker = withApplyLock(async () => {
    markLockHeld();
    await lockReleased;
  });
  await lockHeld;

  let harness: Harness | undefined;
  let pending: ReturnType<typeof run> | undefined;
  try {
    harness = await startHarness(makeTool);
    const activeHarness = harness;
    pending = run(activeHarness, args);
    await vi.waitFor(() => expect(sessionResolution.resolveSession).toHaveBeenCalled());
    await vi
      .waitFor(() => expect(activeHarness.server.requests.length).toBeGreaterThan(0), {
        timeout: 100,
        interval: 5,
      })
      .catch(() => undefined);
    expect(activeHarness.server.requests).toHaveLength(0);
    expect(
      activeHarness.server.requests.filter(
        ({ method, path }) => method === 'POST' && path === mutationPath,
      ),
    ).toHaveLength(0);

    releaseLock();
    await blocker;

    const { result } = await pending;
    expect(result.isError).toBeFalsy();
    expect(
      activeHarness.server.requests.filter(
        ({ method, path }) => method === 'POST' && path === mutationPath,
      ),
    ).toHaveLength(1);
  } finally {
    releaseLock();
    await blocker;
    await pending?.catch(() => undefined);
    await harness?.close();
  }
}

function instanceFor(server: MockExternalApiServer): ExternalApiInstance {
  return {
    baseUrl: server.baseUrl,
    token: 'valid-token',
    pid: 999,
    instanceId: 'inst-sheet-tools',
    apiVersion: '0.2.4',
  };
}
