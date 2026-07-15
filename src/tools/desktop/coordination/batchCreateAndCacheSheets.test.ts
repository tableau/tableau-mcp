import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getBatchCreateAndCacheSheetsTool } from './batchCreateAndCacheSheets.js';

vi.mock('../../../desktop/commands/workbook/getWorkbookXml.js');
vi.mock('../../../desktop/commands/workbook/loadWorkbookXml.js');
vi.mock('../../../desktop/commands/workbook/getWorksheetXml.js');
vi.mock('../../../desktop/commands/workbook/getDashboardXml.js');
vi.mock('../../../desktop/metadata/index.js');
vi.mock('fs');

import { writeFileSync } from 'fs';

import { getDashboardXml } from '../../../desktop/commands/workbook/getDashboardXml.js';
import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { getWorksheetXml } from '../../../desktop/commands/workbook/getWorksheetXml.js';
import { loadWorkbookXml } from '../../../desktop/commands/workbook/loadWorkbookXml.js';
import { addDashboard, addSheet } from '../../../desktop/metadata/index.js';
import { deflectionText } from '../../../desktop/route/route-gate.js';
import { sessionRouteState } from '../../../desktop/route/route-state.js';
import { TableauDesktopRequestHandlerExtra } from '../toolContext.js';

const SESSION = 'session-1';
const FLAG = 'ROUTE_ENFORCEMENT';
const ORIGINAL_ROUTE_ENFORCEMENT = process.env[FLAG];

const WORKBOOK_XML = '<?xml version="1.0"?><workbook><worksheets/></workbook>';
const WORKSHEET_XML = '<worksheet name="Sheet1"><table/></worksheet>';
const DASHBOARD_XML = '<dashboard name="My Dashboard"/>';

function makeExtra(): TableauDesktopRequestHandlerExtra {
  const extra = getMockRequestHandlerExtra();
  extra.getExecutor = vi.fn().mockResolvedValue({});
  vi.mocked(getWorkbookXml).mockResolvedValue(new Ok(WORKBOOK_XML));
  vi.mocked(addSheet).mockReturnValue(WORKBOOK_XML);
  vi.mocked(addDashboard).mockReturnValue(WORKBOOK_XML);
  vi.mocked(loadWorkbookXml).mockResolvedValue(new Ok(undefined));
  vi.mocked(getWorksheetXml).mockResolvedValue(new Ok(WORKSHEET_XML));
  vi.mocked(getDashboardXml).mockResolvedValue(new Ok(DASHBOARD_XML));
  vi.mocked(writeFileSync).mockImplementation(() => {});
  return extra;
}

describe('batchCreateAndCacheSheetsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getBatchCreateAndCacheSheetsTool(new DesktopMcpServer());
    expect(tool.name).toBe('batch-create-and-cache-sheets');
    expect(tool.annotations).toMatchObject({ readOnlyHint: false });
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      worksheetNames: expect.any(Object),
      dashboardName: expect.any(Object),
    });
  });

  it('should succeed and return file paths on happy path', async () => {
    const result = await getResult({
      session: SESSION,
      worksheetNames: ['Sheet1', 'Sheet2'],
      dashboardName: 'My Dashboard',
    });

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Sheet1');
    expect(result.content[0].text).toContain('Sheet2');
    expect(result.content[0].text).toContain('My Dashboard');
    expect(result.content[0].text).toContain('Ready for Phase 2');
  });

  it('should call addSheet for each worksheet name', async () => {
    await getResult({
      session: SESSION,
      worksheetNames: ['WS1', 'WS2', 'WS3'],
      dashboardName: 'DB',
    });

    expect(addSheet).toHaveBeenCalledTimes(3);
    expect(addDashboard).toHaveBeenCalledWith(expect.any(String), 'DB');
  });

  it('should return error when getWorkbookXml fails', async () => {
    const extra = makeExtra();
    vi.mocked(getWorkbookXml).mockResolvedValue(
      new Err({
        type: 'command-failed' as const,
        error: { code: 'E1', message: 'fail', recoverable: false },
      }),
    );

    const result = await getResult(
      { session: SESSION, worksheetNames: [], dashboardName: 'DB' },
      extra,
    );
    expect(result.isError).toBe(true);
  });

  it('should return error when loadWorkbookXml fails', async () => {
    const extra = makeExtra();
    vi.mocked(loadWorkbookXml).mockResolvedValue(
      new Err({
        type: 'execute-command-error',
        error: {
          type: 'command-failed' as const,
          error: { code: 'E1', message: 'fail', recoverable: false },
        },
      }),
    );

    const result = await getResult(
      { session: SESSION, worksheetNames: ['S1'], dashboardName: 'DB' },
      extra,
    );
    expect(result.isError).toBe(true);
  });

  it('should include warnings in the result when worksheet fetch fails', async () => {
    const extra = makeExtra();
    vi.mocked(getWorksheetXml).mockResolvedValue(
      new Err({
        type: 'get-worksheet-xml-error',
        error: { type: 'no-worksheet-found' as const, message: 'Not found' },
      }),
    );

    const result = await getResult(
      {
        session: SESSION,
        worksheetNames: ['Missing'],
        dashboardName: 'DB',
      },
      extra,
    );

    // Should succeed overall but include warnings
    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Warnings');
  });

  it('should write files for each successfully fetched worksheet', async () => {
    await getResult({
      session: SESSION,
      worksheetNames: ['Sheet1'],
      dashboardName: 'DB',
    });

    expect(writeFileSync).toHaveBeenCalled();
  });
});

describe('batchCreateAndCacheSheetsTool — route gate (ROUTE_ENFORCEMENT)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionRouteState.clear();
    delete process.env[FLAG];
  });

  afterEach(() => {
    sessionRouteState.clear();
    if (ORIGINAL_ROUTE_ENFORCEMENT === undefined) delete process.env[FLAG];
    else process.env[FLAG] = ORIGINAL_ROUTE_ENFORCEMENT;
  });

  function seedPendingBindFirst(): void {
    sessionRouteState.recordAskClassification(SESSION, {
      ask: 'bar chart of sales by region',
      route: 'bind-first',
      shape: 'bind-first-template',
      template: 'ranking-ordered-bar',
    });
  }

  const params = {
    session: SESSION,
    worksheetNames: ['Sheet1', 'Sheet2'],
    dashboardName: 'My Dashboard',
  };

  it('flag off executes normally even with a pending current_ask', async () => {
    seedPendingBindFirst();

    const result = await getResult(params);

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Ready for Phase 2');
    expect(getWorkbookXml).toHaveBeenCalledTimes(1);
    expect(writeFileSync).toHaveBeenCalled();
  });

  it('flag on returns the deflection before fetching or writing workbook XML', async () => {
    process.env[FLAG] = 'on';
    seedPendingBindFirst();

    const result = await getResult(params);

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(deflectionText('ranking-ordered-bar'));
    invariant(result.content[1].type === 'text');
    expect(JSON.parse(result.content[1].text)).toEqual({
      next_route: 'bind-first',
      template: 'ranking-ordered-bar',
    });
    expect(getWorkbookXml).not.toHaveBeenCalled();
    expect(loadWorkbookXml).not.toHaveBeenCalled();
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('flag on deflects once, then an identical second call executes normally', async () => {
    process.env[FLAG] = 'on';
    seedPendingBindFirst();

    const first = await getResult(params);
    const second = await getResult(params);

    expect(first.isError).toBe(false);
    invariant(first.content[0].type === 'text');
    expect(first.content[0].text).toBe(deflectionText('ranking-ordered-bar'));
    expect(second.isError).toBeFalsy();
    invariant(second.content[0].type === 'text');
    expect(second.content[0].text).toContain('Ready for Phase 2');
    expect(getWorkbookXml).toHaveBeenCalledTimes(1);
    expect(writeFileSync).toHaveBeenCalled();
  });

  it('flag on with no current_ask executes normally', async () => {
    process.env[FLAG] = 'on';

    const result = await getResult(params);

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Ready for Phase 2');
    expect(getWorkbookXml).toHaveBeenCalledTimes(1);
  });

  it('flag on with an already-concluded current_ask executes normally', async () => {
    process.env[FLAG] = 'on';
    seedPendingBindFirst();
    sessionRouteState.recordAskOutcome(SESSION, 'bar chart of sales by region', 'bound');

    const result = await getResult(params);

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Ready for Phase 2');
    expect(getWorkbookXml).toHaveBeenCalledTimes(1);
  });
});

async function getResult(
  params: { session: string; worksheetNames: string[]; dashboardName: string },
  extra = makeExtra(),
): Promise<CallToolResult> {
  const tool = getBatchCreateAndCacheSheetsTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(params, extra);
}
