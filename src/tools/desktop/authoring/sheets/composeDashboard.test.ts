import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import * as externalDiscovery from '../../../../desktop/externalApi/discovery.js';
import {
  extractDashboardXml,
  listWorkbookDashboards,
} from '../../../../desktop/metadata/dashboards.js';
import * as getWorkbookXmlModule from '../../../../desktop/wrappers/getWorkbookXml.js';
import * as loadWorkbookXmlModule from '../../../../desktop/wrappers/loadWorkbookXml.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { TableauDesktopToolContext } from '../../toolContext.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getComposeDashboardTool } from './composeDashboard.js';

vi.mock('../../../../desktop/externalApi/discovery.js');
vi.mock('../../../../desktop/wrappers/getWorkbookXml.js');
vi.mock('../../../../desktop/wrappers/loadWorkbookXml.js');

const LIVE_WORKBOOK = `<?xml version="1.0"?>
<workbook>
  <worksheets>
    <worksheet name="Sales"><table/></worksheet>
    <worksheet name="Profit"><table/></worksheet>
  </worksheets>
  <dashboards>
    <dashboard name="Keep"><zones><zone name="Sales"/></zones></dashboard>
    <dashboard name="Sales Dashboard"><zones><zone name="Old"/></zones></dashboard>
  </dashboards>
  <windows>
    <window class="worksheet" name="Sales"/>
    <window class="worksheet" name="Profit"/>
    <window class="dashboard" name="Keep"><viewpoints><viewpoint name="Sales"/></viewpoints></window>
    <window class="dashboard" name="Sales Dashboard"><viewpoints><viewpoint name="Old"/></viewpoints></window>
  </windows>
</workbook>`;

describe('composeDashboardTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockReset();
    vi.mocked(loadWorkbookXmlModule.loadWorkbookXml).mockReset();
    vi.mocked(externalDiscovery.discoverInstances).mockReset();
    vi.mocked(externalDiscovery.discoverInstances).mockReturnValue([]);
  });

  it('composes existing rendered worksheets with one whole-workbook apply and verifies readback', async () => {
    const harness = setupHarness();

    const result = await getToolResult({ getExecutor: harness.getExecutor });

    expect(result.isError).toBe(false);
    expect(bodyOf(result)).toMatchObject({
      applied: true,
      dashboard: 'Sales Dashboard',
      worksheets: ['Sales', 'Profit'],
      verification: { status: 'passed' },
    });
    expect(loadWorkbookXmlModule.loadWorkbookXml).toHaveBeenCalledTimes(1);
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(2);
    expect(harness.postedXml).toContain('type-v2="text"');
    expect(harness.postedXml).toContain('name="Sales"');
    expect(harness.postedXml).toContain('name="Profit"');
  });

  it('rejects a missing live rendered worksheet before dispatch', async () => {
    const harness = setupHarness();

    const result = await getToolResult({
      worksheetNames: ['Sales', 'Missing'],
      getExecutor: harness.getExecutor,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Missing');
    expect(loadWorkbookXmlModule.loadWorkbookXml).not.toHaveBeenCalled();
  });

  it('rejects duplicate worksheet input before dispatch', async () => {
    const harness = setupHarness();

    const result = await getToolResult({
      worksheetNames: ['Sales', 'Sales'],
      getExecutor: harness.getExecutor,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Duplicate');
    expect(loadWorkbookXmlModule.loadWorkbookXml).not.toHaveBeenCalled();
  });

  it('replaces only the same-named dashboard', async () => {
    const harness = setupHarness();

    const result = await getToolResult({ getExecutor: harness.getExecutor });

    expect(result.isError).toBe(false);
    expect(listWorkbookDashboards(harness.postedXml)).toEqual(['Keep', 'Sales Dashboard']);
    expect(
      listWorkbookDashboards(harness.postedXml).filter((name) => name === 'Sales Dashboard'),
    ).toHaveLength(1);
    expect(harness.postedXml).not.toContain('name="Old"');
    expect(bodyOf(result)).toMatchObject({ replaced: true });
  });

  it('collapses canonically equivalent existing dashboards and windows to one requested target', async () => {
    const nfdName = 'Re\u0301sume\u0301';
    const nfcName = 'R\u00e9sum\u00e9';
    const pristineXml = LIVE_WORKBOOK.replaceAll('Sales Dashboard', nfdName)
      .replace(
        '</dashboards>',
        `<dashboard name="${nfcName}"><zones><zone name="Old" /></zones></dashboard></dashboards>`,
      )
      .replace(
        '</windows>',
        `<window class="dashboard" name="${nfcName}"><viewpoints /></window></windows>`,
      );
    const harness = setupHarness({ pristineXml });

    const result = await getToolResult({
      dashboardName: nfcName,
      getExecutor: harness.getExecutor,
    });

    expect(result.isError).toBe(false);
    expect(
      listWorkbookDashboards(harness.postedXml).filter((name) =>
        ['Re\u0301sume\u0301', 'R\u00e9sum\u00e9'].some(
          (candidate) => name.normalize('NFC') === candidate.normalize('NFC'),
        ),
      ),
    ).toEqual([nfcName]);
  });

  it('preserves unrelated dashboards and all worksheets', async () => {
    const harness = setupHarness();
    const keepBefore = extractDashboardXml(LIVE_WORKBOOK, 'Keep');

    const result = await getToolResult({ getExecutor: harness.getExecutor });

    expect(result.isError).toBe(false);
    expect(compactXml(extractDashboardXml(harness.postedXml, 'Keep'))).toBe(compactXml(keepBefore));
    expect(harness.postedXml).toContain('<worksheet name="Sales"');
    expect(harness.postedXml).toContain('<worksheet name="Profit"');
  });

  it('forwards the pristine baseline so an unrelated pre-existing dashboard defect does not block dispatch', async () => {
    const pristineXml = LIVE_WORKBOOK.replace(
      '<window class="dashboard" name="Keep"><viewpoints><viewpoint name="Sales"/></viewpoints></window>',
      '<window class="dashboard" name="Keep"/>',
    );
    const harness = setupHarness({ pristineXml });

    const result = await getToolResult({ getExecutor: harness.getExecutor });

    expect(result.isError).toBe(false);
    expect(loadWorkbookXmlModule.loadWorkbookXml).toHaveBeenCalledTimes(1);
    expect(loadWorkbookXmlModule.loadWorkbookXml).toHaveBeenCalledWith(
      expect.objectContaining({ baselineXml: pristineXml, expectedWorkbookXml: pristineXml }),
    );
  });

  it('reports workbook drift as safely retryable before dispatch', async () => {
    const harness = setupHarness({
      applyResult: Err({
        type: 'load-workbook-xml-error',
        error: { type: 'workbook-drift' },
      }),
    });

    const result = await getToolResult({ getExecutor: harness.getExecutor });

    expect(result.isError).toBe(true);
    expect(bodyOf(result)).toMatchObject({
      applied: false,
      retrySafe: true,
      dashboard: 'Sales Dashboard',
      stage: 'pre-dispatch-workbook-drift',
    });
    expect(textOf(result)).toContain('workbook changed');
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(1);
  });

  it('reports timeout uncertainty as unknown and unsafe to retry', async () => {
    const harness = setupHarness({
      applyResult: Err({
        type: 'execute-command-error',
        error: { type: 'command-timed-out', error: 'Timeout' },
      }),
    });

    const result = await getToolResult({ getExecutor: harness.getExecutor });

    expect(result.isError).toBe(true);
    expect(bodyOf(result)).toMatchObject({
      applied: 'unknown',
      retrySafe: false,
      dashboard: 'Sales Dashboard',
      stage: 'apply',
    });
    expect(textOf(result)).not.toContain('Nothing was applied');
    expect(textOf(result)).toContain('list-dashboards');
    expect(textOf(result)).toContain('get-workbook-inventory');
    expect(textOf(result)).toContain('activate-sheet');
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(1);
  });

  it('reports a host load rejection as unknown and unsafe to retry', async () => {
    const harness = setupHarness({
      applyResult: Err({
        type: 'load-workbook-xml-error',
        error: { type: 'load-rejected', message: 'Desktop rejected the posted document' },
      }),
    });

    const result = await getToolResult({ getExecutor: harness.getExecutor });

    expect(result.isError).toBe(true);
    expect(bodyOf(result)).toMatchObject({
      applied: 'unknown',
      retrySafe: false,
      dashboard: 'Sales Dashboard',
      stage: 'apply',
    });
    expect(textOf(result)).toContain('Desktop rejected the posted document');
  });

  it('reports a post-apply readback mismatch as unknown and unsafe to retry', async () => {
    const harness = setupHarness({ readbackXml: LIVE_WORKBOOK });

    const result = await getToolResult({ getExecutor: harness.getExecutor });

    expect(result.isError).toBe(true);
    expect(bodyOf(result)).toMatchObject({
      applied: 'unknown',
      retrySafe: false,
      dashboard: 'Sales Dashboard',
      stage: 'readback-verification',
    });
    expect(bodyOf(result).verificationIssues).toEqual(expect.arrayContaining([expect.any(String)]));
    expect(loadWorkbookXmlModule.loadWorkbookXml).toHaveBeenCalledTimes(1);
  });
});

function setupHarness({
  applyResult = Ok({ validationWarnings: [] }),
  readbackXml,
  pristineXml = LIVE_WORKBOOK,
}: {
  applyResult?: Awaited<ReturnType<typeof loadWorkbookXmlModule.loadWorkbookXml>>;
  readbackXml?: string;
  pristineXml?: string;
} = {}): {
  getExecutor: TableauDesktopToolContext['getExecutor'];
  readonly postedXml: string;
} {
  let postedXml = '';
  vi.mocked(getWorkbookXmlModule.getWorkbookXml)
    .mockResolvedValueOnce(Ok(pristineXml))
    .mockImplementation(async () => Ok(readbackXml ?? postedXml));
  vi.mocked(loadWorkbookXmlModule.loadWorkbookXml).mockImplementation(async ({ xml }) => {
    postedXml = xml;
    return applyResult;
  });
  const getExecutor = vi.fn().mockResolvedValue({});
  return {
    getExecutor,
    get postedXml() {
      return postedXml;
    },
  };
}

async function getToolResult({
  dashboardName = 'Sales Dashboard',
  worksheetNames = ['Sales', 'Profit'],
  getExecutor,
}: {
  dashboardName?: string;
  worksheetNames?: string[];
  getExecutor: TableauDesktopToolContext['getExecutor'];
}): Promise<CallToolResult> {
  const tool = getComposeDashboardTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      session: '1',
      dashboardName,
      worksheetNames,
      title: 'Executive Overview',
      layout: { layoutType: 'columns' },
    },
    { ...getMockRequestHandlerExtra(), getExecutor },
  );
}

function textOf(result: CallToolResult): string {
  invariant(result.content[0]?.type === 'text');
  return result.content[0].text;
}

function bodyOf(result: CallToolResult): Record<string, any> {
  return JSON.parse(textOf(result)) as Record<string, any>;
}

function compactXml(xml: string | null): string | null {
  return xml?.replace(/>\s+</g, '><').trim() ?? null;
}
