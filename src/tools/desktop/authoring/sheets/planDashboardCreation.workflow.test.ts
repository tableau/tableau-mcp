import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { makeExecutorMock } from '../../../../desktop/externalApi/executor.mock.js';
import { extractDashboardXml, listDashboardRefs } from '../../../../desktop/metadata/dashboards.js';
import { extractSheetXml, listWorksheetRefs } from '../../../../desktop/metadata/sheets.js';
import { TemplateArtifactStore } from '../../../../desktop/templates/templateArtifactStore.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getApplyWorksheetTool } from '../../api/applyWorksheet.js';
import { getGetDashboardXmlTool } from '../../api/getDashboardXml.js';
import { getGetWorkbookXmlTool } from '../../api/getWorkbookXml.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getBuildWorksheetsFromTemplatesTool } from '../templates/buildWorksheetsFromTemplates.js';
import { getBatchCreateAndCacheSheetsTool } from './batchCreateAndCacheSheets.js';
import { getBuildAndApplyDashboardTool } from './buildAndApplyDashboard.js';
import { getPlanDashboardCreationTool } from './planDashboardCreation.js';

const cache = vi.hoisted(() => ({ directory: '' }));
const workbook =
  '<workbook><datasources><datasource name="Superstore"><column name="[Sales]" datatype="real" role="measure" type="quantitative"/><column name="[Category]" datatype="string" role="dimension" type="nominal"/><column name="[Order Date]" datatype="date" role="dimension" type="ordinal"/><column name="[Order Timestamp]" datatype="datetime" role="dimension" type="ordinal"/></datasource></datasources><worksheets/><dashboards/><windows/></workbook>';
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

  it.each([
    { template: undefined, query: 'Sales', derivation: 'Sum', prefix: 'sum', native: true },
    { template: undefined, query: 'avg of Sales', derivation: 'Avg', prefix: 'avg', native: true },
    { template: undefined, query: 'Sales', derivation: 'Sum', prefix: 'sum' },
    { template: 'insights__bar_chart', query: 'Sales', derivation: 'Sum', prefix: 'sum' },
    ...['avg', 'min', 'max', 'count', 'countd'].map((aggregation) => ({
      template: undefined,
      query: `${aggregation} of Sales`,
      derivation: (
        { avg: 'Avg', min: 'Min', max: 'Max', count: 'Count', countd: 'CountD' } as Record<
          string,
          string
        >
      )[aggregation],
      prefix:
        ({ count: 'cnt', countd: 'ctd' } as Record<string, string>)[aggregation] ?? aggregation,
    })),
    ...['Order Date', 'Order Timestamp'].flatMap((field) =>
      ['min', 'max'].flatMap((prefix) =>
        [undefined, 'insights__bar_chart'].map((template) => ({
          template,
          query: `${prefix} of ${field}`,
          field,
          derivation: prefix === 'min' ? 'Min' : 'Max',
          prefix,
        })),
      ),
    ),
    { template: undefined, query: '[Superstore].[sum:Sales:qk]', derivation: 'Sum', prefix: 'sum' },
    {
      template: undefined,
      query: 'avg of Sales',
      derivation: 'Avg',
      prefix: 'avg',
      category: '[Superstore].[none:Category:nk]',
    },
  ])(
    'executes production worksheet calls before registered dashboard apply (aggregation=%j)',
    async ({ template, query, derivation, prefix, ...options }) => {
      const field = ('field' in options ? options.field : undefined) ?? 'Sales';
      const native = 'native' in options && options.native === true;
      let live = workbook;
      const completed = Ok({ command_id: 'apply', status: 'completed', submitted_at: '' } as const);
      const executor = makeExecutorMock({
        desktopApiVersion: native ? '0.2.22' : '0.2.21',
        getWorkbookDocument: vi
          .fn()
          .mockImplementation(async () => Ok({ xml: live, instanceId: 'plan-instance' })),
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
        applyWorkbookDocument: vi.fn().mockImplementation(async (xml: string, _signal, options) => {
          options?.onDispatch?.();
          live = xml;
          return completed;
        }),
        executeCommand: vi.fn().mockResolvedValue(completed),
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
          if (native) {
            // Simulate only the native endpoint's registration contract; all MCP calls are real.
            const window = Array.from(doc.getElementsByTagName('window')).find(
              (node) => node.getAttribute('name') === name,
            )!;
            const viewpoints = window.getElementsByTagName('viewpoints')[0];
            for (const worksheetName of ['A', 'B']) {
              const viewpoint = doc.createElement('viewpoint');
              viewpoint.setAttribute('name', worksheetName);
              viewpoints.appendChild(viewpoint);
            }
          }
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
          worksheets: [
            { name: 'A', type: 'kpi' as const, fields: [query] },
            {
              name: 'B',
              type: 'chart' as const,
              template,
              fields: [query, ('category' in options ? options.category : undefined) ?? 'Category'],
            },
          ],
        },
        extra,
      );
      expect(planned.isError, payloadText(planned)).toBe(false);
      const plan = payload(planned).plan;
      expect(plan.metadata.automaticCompletionSupported).toBe(native);
      expect(plan.phase2Parallel.tasks.map((task: any) => task.task_type)).toEqual([
        'worksheet',
        'worksheet',
      ]);
      expect(plan.phase3Registration.required).toBe(!native);
      expect(plan.phase4Dashboard.dependsOn).toBe(native ? 'phase2Parallel' : 'phase3Registration');
      expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();

      const batch = await Provider.from(getBatchCreateAndCacheSheetsTool(server).callback);
      const created = await batch(plan.phase1Prework.params, extra);
      expect(created.isError).toBe(false);
      expect(payload(created).readiness).toEqual({ worksheetBuild: true, dashboardApply: native });
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

      // Execute the generated Phase 2 calls through both production tools and their schemas.
      const store = new TemplateArtifactStore({ capacity: 4 });
      const buildTool = getBuildWorksheetsFromTemplatesTool(server, { store });
      const applyWorksheetTool = getApplyWorksheetTool(server, { store });
      const build = await Provider.from(buildTool.callback);
      const applyWorksheet = await Provider.from(applyWorksheetTool.callback);
      for (const worksheet of plan.phase2Parallel.tasks) {
        expect(worksheet.build.tool).toBe(buildTool.name);
        expect(worksheet.apply.tool).toBe(applyWorksheetTool.name);
        const beforeBuild = vi.mocked(executor.applyWorkbookDocument).mock.calls.length;
        const buildParams = z
          .object(await Provider.from(buildTool.paramsSchema))
          .parse(worksheet.build.params);
        const built = await build(
          {
            ...buildParams,
            session: buildParams.session,
            derivationOverrides: buildParams.derivationOverrides,
            topN: buildParams.topN,
          },
          extra,
        );
        expect(built.isError, payloadText(built)).toBe(false);
        expect(executor.applyWorkbookDocument).toHaveBeenCalledTimes(beforeBuild);
        const binding = worksheet.apply.artifactBinding;
        expect(binding.from).toBe('build');
        const artifactId = payload(built)[binding.resultPath];
        expect(artifactId).toEqual(expect.any(String));
        const applyParams = z.object(await Provider.from(applyWorksheetTool.paramsSchema)).parse({
          ...worksheet.apply.params,
          [binding.bindTo]: artifactId,
        });
        const applied = await applyWorksheet(
          {
            ...applyParams,
            session: applyParams.session,
            artifactId: applyParams.artifactId,
            worksheetName: applyParams.worksheetName,
            worksheetFile: applyParams.worksheetFile,
            templatePlan: applyParams.templatePlan,
          },
          extra,
        );
        expect(applied.isError, payloadText(applied)).toBe(false);
        expect(payload(applied)).toMatchObject({
          artifactId,
          title: worksheet.worksheetName,
          applied: true,
        });
      }
      // Inspect the real builder output after production apply/readback, not just the plan.
      for (const name of ['A', 'B']) {
        const sheet = extractSheetXml(live, name)!;
        const doc = new DOMParser().parseFromString(sheet, 'text/xml');
        const instances = Array.from(doc.getElementsByTagName('column-instance')).filter(
          (instance) => instance.getAttribute('column') === `[${field}]`,
        );
        expect(instances.length).toBeGreaterThan(0);
        expect(
          instances.every((instance) => instance.getAttribute('derivation') === derivation),
        ).toBe(true);
        expect(sheet).toContain(`[${prefix}:${field}:qk]`);
        if (prefix !== 'sum') expect(sheet).not.toContain(`[sum:${field}:qk]`);
        if (field !== 'Sales') {
          const source = Array.from(doc.getElementsByTagName('column')).find(
            (column) => column.getAttribute('name') === `[${field}]`,
          )!;
          expect(source.getAttribute('datatype')).toBe(
            field === 'Order Date' ? 'date' : 'datetime',
          );
          expect(source.getAttribute('type')).toBe('ordinal');
        }
      }
      const worksheetWrites = vi.mocked(executor.applyWorkbookDocument).mock.calls.length;
      if (!native) {
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
      }

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
      expect(executor.applyWorksheetDocument).not.toHaveBeenCalled();
      expect(worksheetWrites).toBe(3);
      expect(executor.applyWorkbookDocument).toHaveBeenCalledTimes(worksheetWrites);
      expect(live).toContain('name="A"');
      expect(live).toContain('name="B"');
      const cachedWorkbook = readFileSync(refreshedFiles.workbookFile, 'utf8');
      if (native) {
        expect(cachedWorkbook).not.toContain('<viewpoint name="B"');
        const dashboardWindow = Array.from(
          new DOMParser().parseFromString(live, 'text/xml').getElementsByTagName('window'),
        ).find((node) => node.getAttribute('name') === 'D')!;
        expect(dashboardWindow.getElementsByTagName('viewpoint')).toHaveLength(2);
      } else {
        expect(cachedWorkbook).toContain('<viewpoint name="B">');
      }
    },
  );

  it.each([
    { template: undefined, fields: ['Sales'], message: 'Explicit template binding BLOCKED' },
    {
      template: undefined,
      fields: ['[Superstore].[avg:Sales:qk]', 'Category'],
      message: 'not_found',
    },
    { template: 'missing-template', fields: ['Sales', 'Category'], message: 'is not available' },
    { template: '../outside', fields: ['Sales', 'Category'], message: 'Invalid template name' },
    {
      template: undefined,
      fields: ['Sales', 'Category'],
      name: 'A'.repeat(256),
      message: 'invalid template build inputs',
    },
  ])(
    'refuses an unusable worksheet plan before any write: %j',
    async ({ template, fields, message, name }) => {
      const executor = makeExecutorMock({
        getWorkbookDocument: vi.fn().mockResolvedValue(Ok({ xml: workbook })),
      });
      const extra = {
        ...getMockRequestHandlerExtra(),
        getExecutor: vi.fn().mockResolvedValue(executor),
      };
      const planner = await Provider.from(
        getPlanDashboardCreationTool(new DesktopMcpServer()).callback,
      );
      const result = await planner(
        {
          session: 'workflow-test',
          dashboardName: 'D',
          title: undefined,
          layout: undefined,
          worksheets: [{ name: name ?? 'A', type: 'chart', template, fields }],
        },
        extra,
      );
      expect(result.isError).toBe(true);
      expect(payloadText(result)).toContain(message);
      expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
      expect(executor.applyWorksheetDocument).not.toHaveBeenCalled();
      expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
    },
  );

  it.each([
    ...['Order Date', 'Order Timestamp'].flatMap((field) =>
      ['sum', 'avg'].map((aggregation) => `${aggregation} of ${field}`),
    ),
    'min of Category',
    'max of Category',
  ])('rejects illegal aggregation %s before writes', async (query) => {
    const executor = makeExecutorMock({
      getWorkbookDocument: vi.fn().mockResolvedValue(Ok({ xml: workbook })),
    });
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(executor),
    };
    const planner = await Provider.from(
      getPlanDashboardCreationTool(new DesktopMcpServer()).callback,
    );
    const result = await planner(
      {
        session: 'workflow-test',
        dashboardName: 'D',
        title: undefined,
        layout: undefined,
        worksheets: [{ name: 'A', type: 'kpi', fields: [query] }],
      },
      extra,
    );
    expect(result.isError).toBe(true);
    expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
    expect(executor.applyWorksheetDocument).not.toHaveBeenCalled();
    expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
  });

  it('refuses two aggregations of the same source rather than silently dropping one', async () => {
    const executor = makeExecutorMock({
      getWorkbookDocument: vi.fn().mockResolvedValue(Ok({ xml: workbook })),
    });
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(executor),
    };
    const planner = await Provider.from(
      getPlanDashboardCreationTool(new DesktopMcpServer()).callback,
    );
    const result = await planner(
      {
        session: 'workflow-test',
        dashboardName: 'D',
        title: undefined,
        layout: undefined,
        worksheets: [
          { name: 'A', type: 'chart', fields: ['avg of Sales', 'sum of Sales', 'Category'] },
        ],
      },
      extra,
    );
    expect(result.isError).toBe(true);
    expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
    expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
  });

  it('refuses a cross-datasource worksheet plan before any write', async () => {
    const xml = workbook.replace(
      '</datasources>',
      '<datasource name="Other"><column name="[Category]" datatype="string" role="dimension" type="nominal"/></datasource></datasources>',
    );
    const executor = makeExecutorMock({
      getWorkbookDocument: vi.fn().mockResolvedValue(Ok({ xml })),
    });
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(executor),
    };
    const planner = await Provider.from(
      getPlanDashboardCreationTool(new DesktopMcpServer()).callback,
    );
    const result = await planner(
      {
        session: 'workflow-test',
        dashboardName: 'D',
        title: undefined,
        layout: undefined,
        worksheets: [
          {
            name: 'A',
            type: 'chart',
            fields: [
              { query: 'Sales', datasource: 'Superstore' },
              { query: 'Category', datasource: 'Other' },
            ],
          },
        ],
      },
      extra,
    );
    expect(result.isError).toBe(true);
    expect(payloadText(result)).toContain('exactly one datasource');
    expect(executor.applyWorkbookDocument).not.toHaveBeenCalled();
    expect(executor.applyWorksheetDocument).not.toHaveBeenCalled();
    expect(executor.applyDashboardDocument).not.toHaveBeenCalled();
  });
});

function payloadText(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return result.content[0].text;
}
