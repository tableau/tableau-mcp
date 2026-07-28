import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import * as listDashboardsModule from '../../../desktop/commands/workbook/listDashboards.js';
import * as listWorksheetsModule from '../../../desktop/commands/workbook/listWorksheets.js';
import * as loadDashboardXmlModule from '../../../desktop/commands/workbook/loadDashboardXml.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getComposeDashboardTool } from './composeDashboard.js';

vi.mock('../../../desktop/commands/workbook/listDashboards.js');
vi.mock('../../../desktop/commands/workbook/listWorksheets.js');
vi.mock('../../../desktop/commands/workbook/loadDashboardXml.js');

describe('composeDashboardTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listWorksheetsModule.listWorksheets).mockResolvedValue(
      Ok({ count: 3, worksheets: ['Sales', 'Profit', 'Orders'] }),
    );
    vi.mocked(listDashboardsModule.listDashboards).mockResolvedValue(
      Ok({ count: 1, dashboards: ['Executive Overview'] }),
    );
    vi.mocked(loadDashboardXmlModule.loadDashboardXml).mockResolvedValue(
      Ok({ validationWarnings: [] }),
    );
  });

  it('composes two existing sheets in the default auto-grid layout', async () => {
    const result = await getToolResult({ worksheets: ['Sales', 'Profit'] });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      dashboardName: 'New Dashboard',
      zones: [
        { worksheet: 'Sales', position: { x: 0, y: 0, width: 50000, height: 100000 } },
        { worksheet: 'Profit', position: { x: 50000, y: 0, width: 50000, height: 100000 } },
      ],
      verification: expect.stringContaining('HOST VERIFICATION — unverified'),
    });
    expect(loadDashboardXmlModule.loadDashboardXml).toHaveBeenCalledWith(
      expect.objectContaining({
        dashboardName: 'New Dashboard',
        xml: expect.stringContaining('name="Sales"'),
        focus: { navigate: 'artifact', sheetName: 'New Dashboard' },
      }),
    );
  });

  it('returns a terminal error naming missing and available worksheets', async () => {
    const result = await getToolResult({ worksheets: ['Sales', 'Missing Sheet'] });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Missing worksheets: "Missing Sheet"');
    expect(result.content[0].text).toContain('Available worksheets: "Sales", "Profit", "Orders"');
    expect(result.content[0].text).toContain('Next call: compose-dashboard');
    expect(loadDashboardXmlModule.loadDashboardXml).not.toHaveBeenCalled();
  });

  it('returns a terminal error when the dashboard name already exists', async () => {
    const result = await getToolResult({ dashboardName: 'Executive Overview' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Dashboard "Executive Overview" already exists');
    expect(result.content[0].text).toContain('Next call: compose-dashboard');
    expect(result.content[0].text).toContain('new dashboardName');
    expect(loadDashboardXmlModule.loadDashboardXml).not.toHaveBeenCalled();
  });

  it('uses gridColumns to position worksheet zones', async () => {
    const result = await getToolResult({
      worksheets: ['Sales', 'Profit', 'Orders'],
      layout: { layoutType: 'auto-grid', gridColumns: 2 },
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).zones).toEqual([
      { worksheet: 'Sales', position: { x: 0, y: 0, width: 50000, height: 50000 } },
      { worksheet: 'Profit', position: { x: 50000, y: 0, width: 50000, height: 50000 } },
      { worksheet: 'Orders', position: { x: 0, y: 50000, width: 50000, height: 50000 } },
    ]);
  });
});

async function getToolResult({
  session = '12345',
  dashboardName = 'New Dashboard',
  worksheets = ['Sales', 'Profit'],
  layout,
  mockExecutor = vi.fn().mockResolvedValue({}),
}: {
  session?: string;
  dashboardName?: string;
  worksheets?: string[];
  layout?: { layoutType: 'auto-grid' | 'rows' | 'columns'; gridColumns?: number };
  mockExecutor?: TableauDesktopToolContext['getExecutor'];
} = {}): Promise<CallToolResult> {
  const tool = getComposeDashboardTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = { ...getMockRequestHandlerExtra(), getExecutor: mockExecutor };
  return await callback({ session, dashboardName, worksheets, layout }, extra);
}
