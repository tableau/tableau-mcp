import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getBatchCreateAndCacheSheetsTool } from './batchCreateAndCacheSheets.js';

vi.mock('../../../../desktop/wrappers/getWorkbookXml.js');
vi.mock('../../../../desktop/wrappers/loadWorkbookXml.js');
vi.mock('../../../../desktop/wrappers/getWorksheetXml.js');
vi.mock('../../../../desktop/wrappers/getDashboardXml.js');
vi.mock('../../../../desktop/wrappers/cacheFingerprint.js');
vi.mock('../../../../desktop/metadata/index.js');
vi.mock('fs');

import { writeFileSync } from 'fs';

import { addDashboard, addSheet } from '../../../../desktop/metadata/index.js';
import { writeSidecar } from '../../../../desktop/wrappers/cacheFingerprint.js';
import { getDashboardXml } from '../../../../desktop/wrappers/getDashboardXml.js';
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import { getWorksheetXml } from '../../../../desktop/wrappers/getWorksheetXml.js';
import { loadWorkbookXml } from '../../../../desktop/wrappers/loadWorkbookXml.js';
import { TableauDesktopRequestHandlerExtra } from '../../toolContext.js';

const SESSION = 'session-1';

const WORKBOOK_XML = '<?xml version="1.0"?><workbook><worksheets/></workbook>';
const WORKSHEET_XML = '<worksheet name="Sheet1"><table/></worksheet>';
const DASHBOARD_XML = '<dashboard name="My Dashboard"/>';

function makeExtra(): TableauDesktopRequestHandlerExtra {
  const extra = getMockRequestHandlerExtra();
  extra.getExecutor = vi.fn().mockResolvedValue({});
  vi.mocked(getWorkbookXml).mockResolvedValue(new Ok(WORKBOOK_XML));
  vi.mocked(addSheet).mockReturnValue(WORKBOOK_XML);
  vi.mocked(addDashboard).mockReturnValue(WORKBOOK_XML);
  vi.mocked(loadWorkbookXml).mockResolvedValue(new Ok({ validationWarnings: [] }));
  vi.mocked(getWorksheetXml).mockResolvedValue(new Ok({ xml: WORKSHEET_XML, name: 'Sheet1' }));
  vi.mocked(getDashboardXml).mockResolvedValue(
    new Ok({ xml: DASHBOARD_XML, name: 'My Dashboard' }),
  );
  vi.mocked(writeFileSync).mockImplementation(() => {});
  vi.mocked(writeSidecar).mockImplementation(() => {});
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
    expect(result.content[0].text).toContain('HOST VERIFICATION — unverified');
    expect(result.content[0].text).toContain('full workbook intent NOT re-verified');
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

  it('keeps the entire batch focus-neutral', async () => {
    await getResult({
      session: SESSION,
      worksheetNames: ['WS1', 'WS2'],
      dashboardName: 'DB',
    });

    expect(loadWorkbookXml).toHaveBeenCalledTimes(1);
    expect(vi.mocked(loadWorkbookXml).mock.calls[0]?.[0]).not.toHaveProperty('activateSheetName');
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

  it('should return an error naming a worksheet fetch failure', async () => {
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

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.succeeded).toEqual({ worksheets: [], dashboard: ['DB'] });
    expect(body.failed).toEqual({
      worksheets: [{ name: 'Missing', error: 'Not found' }],
      dashboard: [],
    });
    expect(body.message).not.toContain('Ready for Phase 2');
  });

  it('should aggregate partial worksheet and dashboard cache failures', async () => {
    const extra = makeExtra();
    vi.mocked(getWorksheetXml)
      .mockResolvedValueOnce(new Ok({ xml: WORKSHEET_XML, name: 'Sheet1' }))
      .mockResolvedValueOnce(
        new Err({
          type: 'get-worksheet-xml-error',
          error: { type: 'no-worksheet-found' as const, message: 'Missing worksheet' },
        }),
      );
    vi.mocked(getDashboardXml).mockResolvedValue(
      new Err({
        type: 'get-dashboard-xml-error',
        error: { type: 'no-dashboard-found' as const, message: 'Missing dashboard' },
      }),
    );

    const result = await getResult(
      {
        session: SESSION,
        worksheetNames: ['Cached', 'Missing'],
        dashboardName: 'DB',
      },
      extra,
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.succeeded).toEqual({ worksheets: ['Cached'], dashboard: [] });
    expect(body.failed).toEqual({
      worksheets: [{ name: 'Missing', error: 'Missing worksheet' }],
      dashboard: [{ name: 'DB', error: 'Missing dashboard' }],
    });
    expect(body.worksheetFiles).toHaveProperty('Cached');
    expect(body.worksheetFiles).not.toHaveProperty('Missing');
    expect(body.dashboardFile).toBeNull();
    expect(body.message).not.toContain('Ready for Phase 2');
  });

  it('should return an error when a fetched worksheet cannot be cached', async () => {
    const extra = makeExtra();
    vi.mocked(writeFileSync)
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error('disk full');
      })
      .mockImplementation(() => {});

    const result = await getResult(
      {
        session: SESSION,
        worksheetNames: ['Uncached'],
        dashboardName: 'DB',
      },
      extra,
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.failed.worksheets).toEqual([
      { name: 'Uncached', error: 'cache write failed: disk full' },
    ]);
    expect(body.succeeded.dashboard).toEqual(['DB']);
    expect(body.message).not.toContain('Ready for Phase 2');
  });

  it('should aggregate worksheet sidecar write failures', async () => {
    const extra = makeExtra();
    vi.mocked(writeSidecar)
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error('sidecar denied');
      })
      .mockImplementation(() => {});

    const result = await getResult(
      {
        session: SESSION,
        worksheetNames: ['NoSidecar'],
        dashboardName: 'DB',
      },
      extra,
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.failed.worksheets).toEqual([
      { name: 'NoSidecar', error: 'cache write failed: sidecar denied' },
    ]);
    expect(body.succeeded.dashboard).toEqual(['DB']);
    expect(body.message).not.toContain('Ready for Phase 2');
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

async function getResult(
  params: { session: string; worksheetNames: string[]; dashboardName: string },
  extra = makeExtra(),
): Promise<CallToolResult> {
  const tool = getBatchCreateAndCacheSheetsTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(params, extra);
}
