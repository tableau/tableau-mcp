import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import * as applyFocusModule from '../../../desktop/commands/workbook/applyFocus.js';
import * as getWorkbookXmlModule from '../../../desktop/commands/workbook/getWorkbookXml.js';
import * as listDashboardsModule from '../../../desktop/commands/workbook/listDashboards.js';
import * as listWorksheetsModule from '../../../desktop/commands/workbook/listWorksheets.js';
import * as loadDashboardXmlModule from '../../../desktop/commands/workbook/loadDashboardXml.js';
import * as loadWorkbookXmlModule from '../../../desktop/commands/workbook/loadWorkbookXml.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getComposeDashboardTool } from './composeDashboard.js';

vi.mock('../../../desktop/commands/workbook/applyFocus.js');
vi.mock('../../../desktop/commands/workbook/getWorkbookXml.js');
vi.mock('../../../desktop/commands/workbook/listDashboards.js');
vi.mock('../../../desktop/commands/workbook/listWorksheets.js');
vi.mock('../../../desktop/commands/workbook/loadDashboardXml.js');
vi.mock('../../../desktop/commands/workbook/loadWorkbookXml.js');

describe('composeDashboardTool', () => {
  const emptyWorkbookXml = '<workbook><windows/></workbook>';

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
    vi.mocked(loadWorkbookXmlModule.loadWorkbookXml).mockResolvedValue(
      Ok({ validationWarnings: [] }),
    );
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockImplementation(async () => {
      const appliedWorkbookXml = vi
        .mocked(loadWorkbookXmlModule.loadWorkbookXml)
        .mock.calls.at(-1)?.[0].xml;
      if (!appliedWorkbookXml) return Ok(emptyWorkbookXml);

      const dashboardXml = vi
        .mocked(loadDashboardXmlModule.loadDashboardXml)
        .mock.calls.at(-1)?.[0].xml;
      const dashboardName =
        /<window\b[^>]*\bclass="dashboard"[^>]*\bname="([^"]+)"/.exec(appliedWorkbookXml)?.[1] ??
        'New Dashboard';
      const viewpointNames = [...appliedWorkbookXml.matchAll(/<viewpoint name="([^"]+)"\/>/g)]
        .map((match) => match[1])
        .sort();
      const viewpoints = viewpointNames.map((name) => `<viewpoint name="${name}"/>`).join('');
      return Ok(
        `<workbook><dashboards>${dashboardXml ?? '<dashboard/>'}</dashboards><windows><window class="dashboard" name="${dashboardName}"><viewpoints>${viewpoints}</viewpoints><active id="-1"/></window></windows></workbook>`,
      );
    });
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
      verification: expect.stringContaining('HOST VERIFICATION — verified'),
    });
    expect(loadDashboardXmlModule.loadDashboardXml).toHaveBeenCalledWith(
      expect.objectContaining({
        dashboardName: 'New Dashboard',
        xml: expect.stringContaining('name="Sales"'),
        focus: { navigate: 'none', reason: 'intermediate-leg' },
      }),
    );
    expect(loadWorkbookXmlModule.loadWorkbookXml).toHaveBeenCalledWith(
      expect.objectContaining({
        xml: expect.stringContaining('<viewpoint name="Sales"/>'),
        focus: { navigate: 'artifact', sheetName: 'New Dashboard' },
      }),
    );
    expect(applyFocusModule.dispatchApplyFocus).not.toHaveBeenCalled();
  });

  it('activates the dashboard when its viewpoints are already present', async () => {
    const alreadyPresentXml = `<workbook>
      <dashboards><dashboard name="New Dashboard"><zones>
        <zone name="Sales" x="0" y="0" w="50000" h="100000"/>
        <zone name="Profit" x="50000" y="0" w="50000" h="100000"/>
      </zones></dashboard></dashboards>
      <windows><window class="dashboard" name="New Dashboard">
        <viewpoints><viewpoint name="Sales"/><viewpoint name="Profit"/></viewpoints>
      </window></windows>
    </workbook>`;
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockResolvedValue(Ok(alreadyPresentXml));

    const result = await getToolResult();

    expect(result.isError).toBe(false);
    expect(loadWorkbookXmlModule.loadWorkbookXml).not.toHaveBeenCalled();
    expect(applyFocusModule.dispatchApplyFocus).toHaveBeenCalledOnce();
    expect(applyFocusModule.dispatchApplyFocus).toHaveBeenCalledWith(
      expect.objectContaining({
        focus: { navigate: 'artifact', sheetName: 'New Dashboard' },
        postedXml: alreadyPresentXml,
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
      layout: { gridColumns: 2 },
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).zones).toEqual([
      { worksheet: 'Sales', position: { x: 0, y: 0, width: 50000, height: 50000 } },
      { worksheet: 'Profit', position: { x: 50000, y: 0, width: 50000, height: 50000 } },
      { worksheet: 'Orders', position: { x: 0, y: 50000, width: 50000, height: 50000 } },
    ]);
  });

  it('returns a terminal error when applying the dashboard fails', async () => {
    vi.mocked(loadDashboardXmlModule.loadDashboardXml).mockResolvedValue(
      Err({
        type: 'execute-command-error',
        error: {
          type: 'command-failed',
          error: { code: 'APPLY_FAILED', message: 'Apply failed', recoverable: false },
        },
      }),
    );

    const result = await getToolResult();

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not confirmed applied');
    expect(result.content[0].text).toContain('Next call:');
    expect(result.content[0].text).not.toContain('"zones"');
  });

  it('refuses duplicate live-resolved worksheet names', async () => {
    const result = await getToolResult({ worksheets: ['Sales', ' Sales '] });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Duplicate worksheet "Sales"');
    expect(result.content[0].text).toContain('Next call: compose-dashboard');
    expect(loadDashboardXmlModule.loadDashboardXml).not.toHaveBeenCalled();
  });

  it('positions worksheet zones in rows', async () => {
    const result = await getToolResult({
      worksheets: ['Sales', 'Profit', 'Orders'],
      layout: { layoutType: 'rows' },
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).zones).toEqual([
      { worksheet: 'Sales', position: { x: 0, y: 0, width: 100000, height: 33333 } },
      { worksheet: 'Profit', position: { x: 0, y: 33333, width: 100000, height: 33333 } },
      { worksheet: 'Orders', position: { x: 0, y: 66666, width: 100000, height: 33333 } },
    ]);
  });

  it('positions worksheet zones in columns', async () => {
    const result = await getToolResult({
      worksheets: ['Sales', 'Profit', 'Orders'],
      layout: { layoutType: 'columns' },
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).zones).toEqual([
      { worksheet: 'Sales', position: { x: 0, y: 0, width: 33333, height: 100000 } },
      { worksheet: 'Profit', position: { x: 33333, y: 0, width: 33333, height: 100000 } },
      { worksheet: 'Orders', position: { x: 66666, y: 0, width: 33333, height: 100000 } },
    ]);
  });

  it('composes the 12-sheet boundary', async () => {
    const worksheets = Array.from({ length: 12 }, (_, index) => `Sheet ${index + 1}`);
    vi.mocked(listWorksheetsModule.listWorksheets).mockResolvedValue(
      Ok({ count: worksheets.length, worksheets }),
    );

    const result = await getToolResult({ worksheets });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const zones = JSON.parse(result.content[0].text).zones;
    expect(zones).toHaveLength(12);
    expect(zones.at(-1)).toEqual({
      worksheet: 'Sheet 12',
      position: { x: 50000, y: 83330, width: 50000, height: 16666 },
    });
  });

  it('returns attempted zones when the viewpoint workbook apply fails', async () => {
    vi.mocked(loadWorkbookXmlModule.loadWorkbookXml).mockResolvedValue(
      Err({
        type: 'load-workbook-xml-error',
        error: { type: 'load-rejected', message: 'Rejected viewpoints' },
      }),
    );

    const result = await getToolResult();

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      dashboardName: 'New Dashboard',
      attemptedZones: expect.any(Array),
      verification: expect.stringMatching(
        /Dashboard "New Dashboard" exists[\s\S]*NOT confirmed[\s\S]*activate-sheet/,
      ),
    });
    expect(result.content[0].text).toContain('do not recreate');
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(1);
  });

  it('reports attempted zones when dashboard readback is unavailable', async () => {
    vi.mocked(getWorkbookXmlModule.getWorkbookXml)
      .mockResolvedValueOnce(Ok(emptyWorkbookXml))
      .mockResolvedValueOnce(
        Err({
          type: 'command-failed',
          error: { code: 'READ_FAILED', message: 'Read failed', recoverable: true },
        }),
      );

    const result = await getToolResult();

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      dashboardName: 'New Dashboard',
      attemptedZones: expect.any(Array),
      verification: expect.stringContaining('NOT confirmed'),
    });
    expect(result.content[0].text).toContain('activate-sheet');
    expect(JSON.parse(result.content[0].text)).not.toHaveProperty('zones');
  });

  it('verifies workbook readback with reordered zones and alphabetized viewpoints', async () => {
    vi.mocked(getWorkbookXmlModule.getWorkbookXml)
      .mockResolvedValueOnce(Ok(emptyWorkbookXml))
      .mockResolvedValueOnce(
        Ok(`<workbook>
          <dashboards>
            <dashboard name="New Dashboard"><zones>
              <zone name="Profit" x="50000" y="0" w="50000" h="100000"/>
              <zone name="Sales" x="0" y="0" w="50000" h="100000"/>
              <zone x="0" y="0" w="100000" h="100000"/>
            </zones></dashboard>
          </dashboards>
          <windows><window class="dashboard" name="New Dashboard">
            <viewpoints><viewpoint name="Profit"/><viewpoint name="Sales"/></viewpoints>
            <active id="-1"/>
          </window></windows>
        </workbook>`),
      );

    const result = await getToolResult();

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      dashboardName: 'New Dashboard',
      zones: expect.any(Array),
      verification: expect.stringContaining('HOST VERIFICATION — verified'),
    });
  });

  it('ignores duplicate named zones in device layouts during readback', async () => {
    vi.mocked(getWorkbookXmlModule.getWorkbookXml)
      .mockResolvedValueOnce(Ok(emptyWorkbookXml))
      .mockResolvedValueOnce(
        Ok(`<workbook>
          <dashboards>
            <dashboard name="New Dashboard">
              <zones>
                <zone name="Sales" x="0" y="0" w="50000" h="100000"/>
                <zone name="Profit" x="50000" y="0" w="50000" h="100000"/>
              </zones>
              <devicelayouts>
                <devicelayout name="Phone">
                  <zones>
                    <zone name="Sales" x="0" y="0" w="100000" h="50000"/>
                    <zone name="Profit" x="0" y="50000" w="100000" h="50000"/>
                  </zones>
                </devicelayout>
              </devicelayouts>
            </dashboard>
          </dashboards>
          <windows><window class="dashboard" name="New Dashboard">
            <viewpoints><viewpoint name="Profit"/><viewpoint name="Sales"/></viewpoints>
            <active id="-1"/>
          </window></windows>
        </workbook>`),
      );

    const result = await getToolResult();

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      dashboardName: 'New Dashboard',
      zones: expect.any(Array),
      verification: expect.stringContaining('HOST VERIFICATION — verified'),
    });
  });

  it('does not verify readback without the dashboard window and requested viewpoints', async () => {
    vi.mocked(getWorkbookXmlModule.getWorkbookXml)
      .mockResolvedValueOnce(Ok(emptyWorkbookXml))
      .mockResolvedValueOnce(
        Ok(`<workbook>
          <dashboards><dashboard name="New Dashboard"><zones>
            <zone name="Sales" x="0" y="0" w="50000" h="100000"/>
            <zone name="Profit" x="50000" y="0" w="50000" h="100000"/>
          </zones></dashboard></dashboards>
          <windows/>
        </workbook>`),
      );

    const result = await getToolResult();

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      attemptedZones: expect.any(Array),
      verification: expect.stringContaining('NOT confirmed'),
    });
  });

  it('does not treat a missing zero-valued coordinate as a zone match', async () => {
    vi.mocked(getWorkbookXmlModule.getWorkbookXml)
      .mockResolvedValueOnce(Ok(emptyWorkbookXml))
      .mockResolvedValueOnce(
        Ok(`<workbook>
          <dashboards><dashboard name="New Dashboard"><zones>
            <zone name="Sales" y="0" w="50000" h="100000"/>
            <zone name="Profit" x="50000" y="0" w="50000" h="100000"/>
          </zones></dashboard></dashboards>
          <windows><window class="dashboard" name="New Dashboard">
            <viewpoints><viewpoint name="Profit"/><viewpoint name="Sales"/></viewpoints>
          </window></windows>
        </workbook>`),
      );

    const result = await getToolResult();

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      attemptedZones: expect.any(Array),
      verification: expect.stringContaining('NOT confirmed'),
    });
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
  layout?: { layoutType?: 'auto-grid' | 'rows' | 'columns'; gridColumns?: number };
  mockExecutor?: TableauDesktopToolContext['getExecutor'];
} = {}): Promise<CallToolResult> {
  const tool = getComposeDashboardTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const paramsSchema = await Provider.from(tool.paramsSchema);
  const extra = { ...getMockRequestHandlerExtra(), getExecutor: mockExecutor };
  const args = z.object(paramsSchema).parse({ session, dashboardName, worksheets, layout });
  return await callback({ ...args, layout: args.layout, session: args.session }, extra);
}
