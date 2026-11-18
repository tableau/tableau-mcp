import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { makeExecutorMock } from '../../../../desktop/externalApi/executor.mock.js';
import * as sessionResolution from '../../../../desktop/session/sessionResolution.js';
import { ArgsValidationError } from '../../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { applyDashboardZoneFormat } from './formatDashboardZones.js';
import { getFormatWorkbookTool } from './formatWorkbook.js';
import { applyWorksheetFormats } from './formatWorksheets.js';
import { applyMemberColors } from './setMemberColors.js';

vi.mock('../../../../desktop/session/sessionResolution.js');
vi.mock('./formatWorksheets.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./formatWorksheets.js')>()),
  applyWorksheetFormats: vi.fn(),
}));
vi.mock('./setMemberColors.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./setMemberColors.js')>()),
  applyMemberColors: vi.fn(),
}));
vi.mock('./formatDashboardZones.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./formatDashboardZones.js')>()),
  applyDashboardZoneFormat: vi.fn(),
}));

const MEMBER_COLORS_RESULT = {
  message: 'Set 1 member color(s).',
  field: 'Category',
  datasource: 'superstore',
  colors: [{ member: 'Furniture', color: '#ff0000' }],
};
const DASHBOARD_RESULT = {
  dashboard: 'Overview',
  cornerRadius: 8,
  zoneIds: ['3'],
  verified: true as const,
};

describe('format-workbook tool', () => {
  beforeEach(() => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('12345'));
    vi.mocked(applyWorksheetFormats).mockResolvedValue(
      Ok({ formatted: [{ worksheet: 'Sales', verified: true }] }),
    );
    vi.mocked(applyMemberColors).mockResolvedValue(Ok(MEMBER_COLORS_RESULT));
    vi.mocked(applyDashboardZoneFormat).mockResolvedValue(Ok(DASHBOARD_RESULT));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('is a write tool', () => {
    const tool = getFormatWorkbookTool(new DesktopMcpServer());
    expect(tool.name).toBe('format-workbook');
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: true });
    expect(Object.keys(tool.paramsSchema)).toEqual(['session', 'changes']);
    expect(tool.annotations).toMatchObject({ destructiveHint: true });
  });

  it('routes each change to its formatter and returns every receipt', async () => {
    const result = await callTool([
      { sheet: 'Sales', showLabels: true, colors: { Furniture: '#ff0000' } },
      { sheet: 'Overview', cornerRadius: 8 },
    ]);

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toEqual({
      worksheets: [{ worksheet: 'Sales', verified: true }],
      memberColors: [MEMBER_COLORS_RESULT],
      dashboards: [DASHBOARD_RESULT],
    });
    expect(applyWorksheetFormats).toHaveBeenCalledWith(
      expect.objectContaining({
        worksheets: [{ name: 'Sales', showLabels: true, numberFormats: undefined }],
      }),
    );
    expect(applyMemberColors).toHaveBeenCalledWith(
      expect.objectContaining({
        worksheetName: 'Sales',
        colors: [{ member: 'Furniture', color: '#ff0000' }],
      }),
    );
    expect(applyDashboardZoneFormat).toHaveBeenCalledWith(
      expect.objectContaining({
        dashboardName: 'Overview',
        request: { cornerRadius: 8, scope: 'all', zoneIds: undefined },
      }),
    );
  });

  it('formats every worksheet change in one preflighted batch', async () => {
    await callTool([
      { sheet: 'Sales', showLabels: true },
      { sheet: 'Profit', numberFormats: [{ field: 'Profit', kind: 'number', decimals: 0 }] },
    ]);

    expect(applyWorksheetFormats).toHaveBeenCalledTimes(1);
    expect(vi.mocked(applyWorksheetFormats).mock.calls[0][0].worksheets).toHaveLength(2);
  });

  it('stops before other formatters when worksheet preflight fails', async () => {
    vi.mocked(applyWorksheetFormats).mockResolvedValue(
      new ArgsValidationError('Field "Discount" is not used by this worksheet.').toErr(),
    );

    const result = await callTool([
      { sheet: 'Sales', showLabels: true },
      { sheet: 'Overview', cornerRadius: 8 },
    ]);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Discount');
    expect(result.content[0].text).not.toContain('already applied');
    expect(applyDashboardZoneFormat).not.toHaveBeenCalled();
  });

  it('says how many changes were already applied when a later change fails', async () => {
    vi.mocked(applyDashboardZoneFormat).mockResolvedValue(
      new ArgsValidationError('Dashboard zone ids were not found: 9.').toErr(),
    );

    const result = await callTool([
      { sheet: 'Sales', showLabels: true },
      { sheet: 'Overview', cornerRadius: 8 },
    ]);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('1 earlier change was already applied.');
  });

  it.each([
    ['sets nothing', { sheet: 'Sales' }, 'sets nothing'],
    [
      'mixes dashboard and worksheet',
      { sheet: 'Overview', cornerRadius: 8, showLabels: true },
      'mixes',
    ],
    ['targets an unknown sheet', { sheet: 'Missing', showLabels: true }, 'Missing'],
    [
      'sends a currency format without a symbol',
      { sheet: 'Sales', numberFormats: [{ field: 'Sales', kind: 'currency' }] },
      'currencySymbol',
    ],
    [
      'sends an out-of-range corner radius',
      { sheet: 'Overview', cornerRadius: 500 },
      'cornerRadius',
    ],
  ])('rejects a change that %s before applying anything', async (_case, change, message) => {
    const result = await callTool([change]);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(message);
    expect(applyWorksheetFormats).not.toHaveBeenCalled();
    expect(applyMemberColors).not.toHaveBeenCalled();
    expect(applyDashboardZoneFormat).not.toHaveBeenCalled();
  });

  it('rounds only the named zones when zone ids are given', async () => {
    await callTool([{ sheet: 'Overview', cornerRadius: 4, zoneIds: ['3'] }]);

    expect(applyDashboardZoneFormat).toHaveBeenCalledWith(
      expect.objectContaining({ request: { cornerRadius: 4, scope: 'zone_ids', zoneIds: ['3'] } }),
    );
  });
});

async function callTool(changes: unknown[]): Promise<CallToolResult> {
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(
      makeExecutorMock({
        listWorksheets: vi.fn().mockResolvedValue(
          Ok({
            worksheets: [
              { id: 'ws-1', name: 'Sales', hidden: false },
              { id: 'ws-2', name: 'Profit', hidden: false },
            ],
          }),
        ),
        listDashboards: vi
          .fn()
          .mockResolvedValue(Ok({ dashboards: [{ id: 'db-1', name: 'Overview' }] })),
      }),
    ),
  };
  const tool = getFormatWorkbookTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ session: '12345', changes } as never, extra);
}
