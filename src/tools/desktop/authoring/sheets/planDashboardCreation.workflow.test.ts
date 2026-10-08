import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Ok } from 'ts-results-es';

import { makeExecutorMock } from '../../../../desktop/externalApi/executor.mock.js';
import { extractDashboardXml, listDashboardRefs } from '../../../../desktop/metadata/dashboards.js';
import {
  extractSheetXml,
  listWorksheetRefs,
  upsertSheetIntoWorkbook,
} from '../../../../desktop/metadata/sheets.js';
import { loadWorksheetXml } from '../../../../desktop/wrappers/loadWorksheetXml.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getGetDashboardXmlTool } from '../../api/getDashboardXml.js';
import { getGetWorkbookXmlTool } from '../../api/getWorkbookXml.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getBatchCreateAndCacheSheetsTool } from './batchCreateAndCacheSheets.js';
import { getBuildAndApplyDashboardTool } from './buildAndApplyDashboard.js';
import { getPlanDashboardCreationTool } from './planDashboardCreation.js';

const cache = vi.hoisted(() => ({ directory: '' }));
// Isolate the file boundary, not the planner, metadata, wrappers, or validation.
vi.mock('../../../../desktop/cache.js', () => ({
  DesktopCache: class {
    getCacheFilePath({ prefix, id }: { prefix: string; id?: string }): string {
      return join(cache.directory, `${prefix}-${id ?? 'readback'}.xml`);
    }
  },
}));

function payload(result: CallToolResult): any {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}

describe('planned dashboard creation through live dashboard apply', () => {
  beforeEach(() => {
    cache.directory = mkdtempSync(join(tmpdir(), 'dashboard-plan-'));
  });
  afterEach(() => {
    rmSync(cache.directory, { recursive: true, force: true });
  });

  it('requires rendered worksheets and Desktop registration before the planned surgical apply can succeed', async () => {
    let live =
      '<workbook><datasources><datasource name="Superstore"><column name="[Sales]" datatype="real" role="measure" type="quantitative"/></datasource></datasources><worksheets/><dashboards/><windows/></workbook>';
    const completed = Ok({ command_id: 'apply', status: 'completed', submitted_at: '' } as const);
    const executor = makeExecutorMock({
      getWorkbookDocument: vi.fn().mockImplementation(async () => Ok({ xml: live })),
      listWorksheets: vi
        .fn()
        .mockImplementation(async () => Ok({ worksheets: listWorksheetRefs(live) })),
      listDashboards: vi
        .fn()
        .mockImplementation(async () => Ok({ dashboards: listDashboardRefs(live) })),
      getWorksheetDocument: vi.fn().mockImplementation(async (id: string) => {
        const name = listWorksheetRefs(live).find((sheet) => sheet.id === id)!.name;
        return Ok({ xml: extractSheetXml(live, name)! });
      }),
      getDashboardDocument: vi.fn().mockImplementation(async (id: string) => {
        const name = listDashboardRefs(live).find((sheet) => sheet.id === id)!.name;
        return Ok({ xml: extractDashboardXml(live, name)! });
      }),
      applyWorkbookDocument: vi.fn().mockImplementation(async (xml: string) => {
        live = xml;
        return completed;
      }),
      applyWorksheetDocument: vi.fn().mockImplementation(async (id: string, xml: string) => {
        const name = listWorksheetRefs(live).find((sheet) => sheet.id === id)!.name;
        live = upsertSheetIntoWorkbook(live, name, xml);
        return completed;
      }),
      applyDashboardDocument: vi.fn().mockImplementation(async (id: string, xml: string) => {
        const name = listDashboardRefs(live).find((sheet) => sheet.id === id)!.name;
        const parser = new DOMParser();
        const doc = parser.parseFromString(live, 'text/xml');
        const existing = Array.from(doc.getElementsByTagName('dashboard')).find(
          (node) => node.getAttribute('name') === name,
        )!;
        const replacement = doc.importNode(
          parser.parseFromString(xml, 'text/xml').documentElement!,
          true,
        );
        // A surgical Desktop edit retains the target sheet's stable identity.
        replacement.appendChild(existing.getElementsByTagName('simple-id')[0].cloneNode(true));
        existing.parentNode!.replaceChild(replacement, existing);
        live = new XMLSerializer().serializeToString(doc);
        return completed;
      }),
    });
    const extra = getMockRequestHandlerExtra();
    extra.getExecutor = vi.fn().mockResolvedValue(executor);
    const server = new DesktopMcpServer();
    const planner = await Provider.from(getPlanDashboardCreationTool(server).callback);
    const planned = await planner(
      {
        session: 'workflow-test',
        dashboardName: 'D',
        title: undefined,
        layout: undefined,
        worksheets: ['A', 'B'].map((name) => ({ name, type: 'chart' as const, fields: ['Sales'] })),
      },
      extra,
    );
    expect(planned.isError).toBe(false);
    const plan = payload(planned).plan;
    expect(plan.metadata.automaticCompletionSupported).toBe(false);
    expect(plan.phase2Parallel.tasks.map((task: any) => task.task_type)).toEqual([
      'worksheet',
      'worksheet',
    ]);
    expect(plan.phase3Registration.required).toBe(true);
    expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();

    const batch = await Provider.from(getBatchCreateAndCacheSheetsTool(server).callback);
    const created = await batch(plan.phase1Prework.params, extra);
    expect(created.isError).toBe(false);
    expect(payload(created).readiness).toEqual({ worksheetBuild: true, dashboardApply: false });
    expect(
      new DOMParser().parseFromString(live, 'text/xml').getElementsByTagName('viewpoint'),
    ).toHaveLength(0);
    expect(executor.applyWorkbookDocument).toHaveBeenCalledTimes(1);

    const apply = await Provider.from(getBuildAndApplyDashboardTool(server).callback);
    const { task_type: _taskType, ...task } = plan.phase4Dashboard.task;
    const applyTask = task;
    const blank = await apply(applyTask, extra);
    expect(blank.isError).toBe(true);
    expect(payloadText(blank)).toContain('no applied mark/encoding');
    expect(executor.applyDashboardDocument).not.toHaveBeenCalled();

    // Phase 2 uses the real worksheet apply wrapper to render each created scaffold.
    for (const worksheet of plan.phase2Parallel.tasks) {
      const doc = new DOMParser().parseFromString(
        readFileSync(worksheet.worksheetFile, 'utf8'),
        'text/xml',
      );
      doc.getElementsByTagName('rows')[0].textContent = '[Superstore].[sum:Sales:qk]';
      const applied = await loadWorksheetXml({
        worksheetName: worksheet.worksheetName,
        xml: new XMLSerializer().serializeToString(doc),
        requireExistingSheet: true,
        focus: { navigate: 'none', reason: 'intermediate-leg' },
        executor,
        signal: extra.signal,
      });
      expect(applied.isErr() ? applied.error : undefined).toBeUndefined();
    }
    const unregistered = await apply(applyTask, extra);
    expect(unregistered.isError).toBe(true);
    expect(payloadText(unregistered)).toContain('needs worksheet view registrations for A, B');
    expect(executor.applyDashboardDocument).not.toHaveBeenCalled();

    // Simulate the explicit user action in Desktop, not an MCP workbook-replacement workaround.
    function registerView(name: string): void {
      const doc = new DOMParser().parseFromString(live, 'text/xml');
      const window = Array.from(doc.getElementsByTagName('window')).find(
        (node) => node.getAttribute('name') === 'D',
      )!;
      const viewpoint = doc.createElement('viewpoint');
      viewpoint.setAttribute('name', name);
      const zoom = doc.createElement('zoom');
      zoom.setAttribute('type', 'standard');
      viewpoint.appendChild(zoom);
      window.getElementsByTagName('viewpoints')[0].appendChild(viewpoint);
      const dashboard = Array.from(doc.getElementsByTagName('dashboard')).find(
        (node) => node.getAttribute('name') === 'D',
      )!;
      const zone = doc.createElement('zone');
      zone.setAttribute('id', String(100 + window.getElementsByTagName('viewpoint').length));
      zone.setAttribute('name', name);
      dashboard.getElementsByTagName('zones')[0].appendChild(zone);
      live = new XMLSerializer().serializeToString(doc);
    }
    registerView('A');
    const partial = await apply(applyTask, extra);
    expect(partial.isError).toBe(true);
    expect(payloadText(partial)).toContain('B');
    expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
    registerView('B');

    // Phase 4 consumes refreshed cache paths, never the original phase-1 snapshots.
    const getWorkbook = await Provider.from(getGetWorkbookXmlTool(server).callback);
    const getDashboard = await Provider.from(getGetDashboardXmlTool(server).callback);
    const refreshedFiles: Record<string, string> = {};
    for (const step of plan.phase4Dashboard.refreshCaches) {
      const refreshed =
        step.tool === 'get-workbook-xml'
          ? await getWorkbook(step.params, extra)
          : await getDashboard(step.params, extra);
      expect(refreshed.isError).toBe(false);
      refreshedFiles[step.bindTo] = payload(refreshed)[step.resultPath];
      expect(refreshedFiles[step.bindTo]).toEqual(expect.any(String));
      expect(refreshedFiles[step.bindTo]).not.toBe(applyTask[step.bindTo]);
    }
    const final = await apply({ ...applyTask, ...refreshedFiles }, extra);
    expect(final.isError, payloadText(final)).toBe(false);
    expect(payload(final)).toMatchObject({ viewpointState: 'success', viewpointCount: 2 });
    expect(executor.applyDashboardDocument).toHaveBeenCalledTimes(1);
    expect(executor.applyWorksheetDocument).toHaveBeenCalledTimes(2);
    expect(executor.applyWorkbookDocument).toHaveBeenCalledTimes(1);
    expect(live).toContain('name="A"');
    expect(live).toContain('name="B"');
    expect(readFileSync(refreshedFiles.workbookFile, 'utf8')).toContain('<viewpoint name="B">');
  });
});

function payloadText(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return result.content[0].text;
}
