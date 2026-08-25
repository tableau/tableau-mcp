import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Ok } from 'ts-results-es';

import { makeExecutorMock } from '../../../../desktop/externalApi/executor.mock.js';
import type { ExternalApiToolExecutor } from '../../../../desktop/externalApi/executorTypes.js';
import { upsertSheetIntoWorkbook } from '../../../../desktop/metadata/sheets.js';
import { sessionRouteState } from '../../../../desktop/route/route-state.js';
import { TemplateArtifactStore } from '../../../../desktop/templates/templateArtifactStore.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getApplyWorksheetTool } from '../../api/applyWorksheet.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getBuildWorksheetsFromTemplatesTool } from './buildWorksheetsFromTemplates.js';

const BOOKMARK =
  "<?xml version='1.0'?><bookmark version='10.1'>" +
  "<datasources><datasource name='donor.ds' caption='Donor Secret'>" +
  "<column name='[Donor Measure]' datatype='real' role='measure' type='quantitative'/>" +
  "<column name='[Donor Dimension]' datatype='string' role='dimension' type='nominal'/>" +
  '</datasource></datasources>' +
  '<table><rows>[donor.ds].[none:Donor Dimension:nk]</rows>' +
  '<cols>[donor.ds].[sum:Donor Measure:qk]</cols></table></bookmark>';

const LIVE_WORKBOOK = `<?xml version='1.0'?><workbook>
  <datasources><datasource name='target.ds'>
    <column name='[Revenue]' datatype='real' role='measure' type='quantitative'/>
    <column name='[Segment]' datatype='string' role='dimension' type='nominal'/>
    <connection class='federated'><named-connections>
      <named-connection name='textscan.0123456789abcdef'><connection class='textscan' /></named-connection>
    </named-connections></connection>
  </datasource></datasources>
  <worksheets><worksheet name='Existing'><table /></worksheet></worksheets>
  <windows><window class='worksheet' name='Existing' /></windows>
</workbook>`;

const SUPERSTORE_WORKBOOK = `<?xml version='1.0'?><workbook>
  <datasources><datasource name='Sample - Superstore'>
    <column name='[Sales]' datatype='real' role='measure' type='quantitative'/>
    <column name='[Profit]' datatype='real' role='measure' type='quantitative'/>
    <column name='[Category]' datatype='string' role='dimension' type='nominal'/>
    <column name='[Product Name]' datatype='string' role='dimension' type='nominal'/>
    <column name='[Region]' datatype='string' role='dimension' type='nominal'/>
    <column name='[Order ID]' datatype='string' role='dimension' type='nominal'/>
    <column name='[Order Date]' datatype='date' role='dimension' type='ordinal'/>
    <column name='[Ship Date]' datatype='date' role='dimension' type='ordinal'/>
  </datasource></datasources>
  <worksheets><worksheet name='Existing'><table /></worksheet></worksheets>
  <windows><window class='worksheet' name='Existing' /></windows>
</workbook>`;

const SHIPPED_TEMPLATE_NAMES = [
  'kpi-text',
  'insights__bar_chart',
  'ranking-ordered-bar',
  'part-to-whole__donut__show-parts-with-center-space-for-total',
  'part-to-whole-pie-chart',
  'gantt-task-rollup-chart',
] as const;

const EXACT_ARGS = {
  session: '12345',
  templateName: 'pulse-bar',
  title: 'Revenue by Segment',
  datasource: 'target.ds',
  fieldMapping: {
    field_base_1: '[target.ds].[none:Segment:nk]',
    field_base_2: '[target.ds].[sum:Revenue:qk]',
  },
};

describe('build-worksheets-from-templates', () => {
  const originalTemplatesDir = process.env['TEMPLATES_DIR'];
  let templatesDir: string;

  beforeEach(() => {
    templatesDir = mkdtempSync(join(process.cwd(), 'tmp-build-template-'));
    writeFileSync(join(templatesDir, 'pulse-bar.tbm'), BOOKMARK);
    for (const templateName of SHIPPED_TEMPLATE_NAMES) {
      writeFileSync(
        join(templatesDir, `${templateName}.tbm`),
        readFileSync(
          join(process.cwd(), 'src', 'desktop', 'data', 'templates', `${templateName}.tbm`),
        ),
      );
    }
    process.env['TEMPLATES_DIR'] = templatesDir;
    sessionRouteState.clear();
  });

  afterEach(() => {
    if (originalTemplatesDir === undefined) delete process.env['TEMPLATES_DIR'];
    else process.env['TEMPLATES_DIR'] = originalTemplatesDir;
    rmSync(templatesDir, { recursive: true, force: true });
    sessionRouteState.clear();
  });

  it('has the singular live-only caller-neutral input contract', async () => {
    const tool = getBuildWorksheetsFromTemplatesTool(new DesktopMcpServer());
    const schema = await Provider.from(tool.paramsSchema);
    expect(tool.name).toBe('build-worksheets-from-templates');
    expect(schema).toMatchObject({
      session: expect.any(Object),
      templateName: expect.any(Object),
      title: expect.any(Object),
      datasource: expect.any(Object),
      fieldMapping: expect.any(Object),
      topN: expect.any(Object),
    });
    expect(schema.fieldMapping.description).toBe('Map slot ID to exact returned column_ref.');
    expect(schema.topN.description).toBe(
      'Limit a simple ranked worksheet to its first N members before storing the artifact.',
    );
    expect(schema).not.toHaveProperty('templates');
    expect(schema).not.toHaveProperty('workbookFile');
    expect(schema).not.toHaveProperty('confirmation');
    expect(tool.annotations).toMatchObject({ readOnlyHint: true });
  });

  it('builds directly from exact Pulse inputs without list, route state, LLM state, or Desktop writes', async () => {
    const store = new TemplateArtifactStore({ capacity: 4 });
    const applyWorkbookDocument = vi.fn();
    const executor = makeExecutorMock({
      getWorkbookDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: LIVE_WORKBOOK,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
          instanceId: 'inst-build',
        }),
      ),
      applyWorkbookDocument,
    });
    const tool = getBuildWorksheetsFromTemplatesTool(new DesktopMcpServer(), {
      store,
      createId: () => 'artifact-A',
    });

    const result = await callTool(tool, EXACT_ARGS, executor);
    expect(result.isError).toBe(false);
    const body = bodyOf(result);
    expect(body).toMatchObject({
      artifactId: 'artifact-A',
      templateName: 'pulse-bar',
      title: 'Revenue by Segment',
      datasource: 'target.ds',
      provenance: 'dev-override',
      bindings: [
        { slotId: 'field_base_1', field: '[target.ds].[none:Segment:nk]' },
        { slotId: 'field_base_2', field: '[target.ds].[sum:Revenue:qk]' },
      ],
    });
    expect(JSON.stringify(body)).not.toMatch(/expiresAt|confirm|workflow|<worksheet|formula/i);
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
    expect(sessionRouteState.get('12345')).toBeUndefined();

    const reserved = store.reserve('artifact-A', '12345');
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    expect(reserved.artifact.worksheetXml).toContain('target.ds');
    expect(reserved.artifact.worksheetXml).toContain('Revenue');
    expect(reserved.artifact.worksheetXml).toContain('Segment');
    expect(reserved.artifact.worksheetXml).not.toMatch(
      /donor\.ds|Donor Measure|Donor Dimension|\{\{/,
    );
    expect(reserved.artifact.windowXml).toContain('Revenue by Segment');
    expect(reserved.artifact.instanceId).toBe('inst-build');
  });

  it('rejects a kpi artifact with a competing fieldMapping key before storing it', async () => {
    const store = new TemplateArtifactStore({ capacity: 4 });
    const executor = makeExecutorMock({
      getWorkbookDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: SUPERSTORE_WORKBOOK,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
          instanceId: 'inst-build',
        }),
      ),
      applyWorkbookDocument: vi.fn(),
    });
    const tool = getBuildWorksheetsFromTemplatesTool(new DesktopMcpServer(), {
      store,
      createId: () => 'artifact-kpi-competing',
    });

    const result = await callTool(
      tool,
      {
        session: '12345',
        templateName: 'kpi-text',
        title: 'Total Sales',
        datasource: 'Sample - Superstore',
        fieldMapping: {
          field_base_1: '[Sample - Superstore].[sum:Sales:qk]',
          competing_metric: '[Sample - Superstore].[sum:Profit:qk]',
        },
      },
      executor,
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('exactly one field');
    expect(result.content[0].text).toContain('received 2');
    expect(store.reserve('artifact-kpi-competing', '12345')).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });

  it('builds and applies the shipped insights bar without leaving a direction token', async () => {
    const server = new DesktopMcpServer();
    const store = new TemplateArtifactStore({ capacity: 4 });
    const posts: string[] = [];
    let liveXml = SUPERSTORE_WORKBOOK;
    const executor = makeExecutorMock({
      getWorkbookDocument: vi.fn(async () =>
        Ok({
          xml: liveXml,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
          instanceId: 'inst-build',
        }),
      ),
      applyWorkbookDocument: vi.fn(async (xml: string) => {
        posts.push(xml);
        liveXml = xml;
        return Ok({ command_id: 'apply', status: 'completed' as const, submitted_at: '' });
      }),
      executeCommand: vi
        .fn()
        .mockResolvedValue(Ok({ command_id: 'focus', status: 'completed', submitted_at: '' })),
    });
    const buildTool = getBuildWorksheetsFromTemplatesTool(server, {
      store,
      createId: () => 'artifact-insights-bar',
    });

    const built = await callTool(
      buildTool,
      {
        session: '12345',
        templateName: 'insights__bar_chart',
        title: 'Sales by Category',
        datasource: 'Sample - Superstore',
        fieldMapping: {
          field_base_1: '[Sample - Superstore].[none:Category:nk]',
          field_base_2: '[Sample - Superstore].[sum:Sales:qk]',
        },
      },
      executor,
    );
    expect(built.isError).toBe(false);

    const applyTool = getApplyWorksheetTool(server, { store });
    const apply = await Provider.from(applyTool.callback);
    const applied = await apply(
      {
        session: '12345',
        artifactId: 'artifact-insights-bar',
        templatePlan: undefined,
        worksheetName: undefined,
        worksheetFile: undefined,
      },
      {
        ...getMockRequestHandlerExtra(),
        getExecutor: vi.fn().mockResolvedValue(executor),
      },
    );

    expect(applied.isError).toBe(false);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain('direction="DESC"');
    expect(posts[0]).not.toContain('{{');
  });

  it('stores a bounded ranked artifact while preserving its computed descending sort', async () => {
    const store = new TemplateArtifactStore({ capacity: 4 });
    const executor = makeExecutorMock({
      getWorkbookDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: SUPERSTORE_WORKBOOK,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
          instanceId: 'inst-build',
        }),
      ),
      applyWorkbookDocument: vi.fn(),
    });
    const tool = getBuildWorksheetsFromTemplatesTool(new DesktopMcpServer(), {
      store,
      createId: () => 'artifact-top-products',
    });

    const result = await callTool(
      tool,
      {
        session: '12345',
        templateName: 'ranking-ordered-bar',
        title: 'Top Products',
        datasource: 'Sample - Superstore',
        fieldMapping: {
          field_base_1: '[Sample - Superstore].[none:Product Name:nk]',
          field_base_2: '[Sample - Superstore].[sum:Sales:qk]',
        },
        topN: 10,
      },
      executor,
    );

    expect(result.isError).toBe(false);
    expect(bodyOf(result)).toMatchObject({ topN: 10 });
    const reserved = store.reserve('artifact-top-products', '12345');
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    expect(reserved.artifact.worksheetXml).toMatch(
      /<groupfilter\b[^>]*function=(['"])end\1[^>]*count=(['"])10\2/,
    );
    expect(reserved.artifact.worksheetXml).toMatch(/<computed-sort\b[^>]*direction=(['"])DESC\1/);
  });

  it('keeps placeholder-shaped text in a user title while rejecting authored residue', async () => {
    const store = new TemplateArtifactStore({ capacity: 4 });
    const executor = makeExecutorMock({
      getWorkbookDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: SUPERSTORE_WORKBOOK,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
          instanceId: 'inst-build',
        }),
      ),
      applyWorkbookDocument: vi.fn(),
    });
    const tool = getBuildWorksheetsFromTemplatesTool(new DesktopMcpServer(), {
      store,
      createId: () => 'artifact-placeholder-title',
    });

    const result = await callTool(
      tool,
      {
        session: '12345',
        templateName: 'insights__bar_chart',
        title: 'Sales {{Q3}}',
        datasource: 'Sample - Superstore',
        fieldMapping: {
          field_base_1: '[Sample - Superstore].[none:Category:nk]',
          field_base_2: '[Sample - Superstore].[sum:Sales:qk]',
        },
      },
      executor,
    );

    expect(result.isError).toBe(false);
    const reserved = store.reserve('artifact-placeholder-title', '12345');
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    expect(reserved.artifact.worksheetXml).toContain('name="Sales {{Q3}}"');
    expect(reserved.artifact.windowXml).toContain('name="Sales {{Q3}}"');
  });

  it('rejects an artifact when an optional template path leaves literal tokens unresolved', async () => {
    const store = new TemplateArtifactStore({ capacity: 4 });
    const executor = makeExecutorMock({
      getWorkbookDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: SUPERSTORE_WORKBOOK,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
          instanceId: 'inst-build',
        }),
      ),
      applyWorkbookDocument: vi.fn(),
    });
    const tool = getBuildWorksheetsFromTemplatesTool(new DesktopMcpServer(), {
      store,
      createId: () => 'artifact-unresolved-literals',
    });

    const result = await callTool(
      tool,
      {
        session: '12345',
        templateName: 'insights__bar_chart',
        title: 'Sales by Category in Date Range',
        datasource: 'Sample - Superstore',
        fieldMapping: {
          field_base_1: '[Sample - Superstore].[none:Category:nk]',
          field_base_2: '[Sample - Superstore].[sum:Sales:qk]',
          field_base_3: '[Sample - Superstore].[none:Order Date:ok]',
        },
      },
      executor,
    );

    expect(result.isError).toBe(true);
    expect(store.reserve('artifact-unresolved-literals', '12345')).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });

  it('rejects the protected donut template before storing an artifact', async () => {
    const store = new TemplateArtifactStore({ capacity: 4 });
    const executor = makeExecutorMock({
      getWorkbookDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: SUPERSTORE_WORKBOOK,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
          instanceId: 'inst-build',
        }),
      ),
      applyWorkbookDocument: vi.fn(),
    });
    const tool = getBuildWorksheetsFromTemplatesTool(new DesktopMcpServer(), {
      store,
      createId: () => 'artifact-donut',
    });

    const result = await callTool(
      tool,
      {
        session: '12345',
        templateName: 'part-to-whole__donut__show-parts-with-center-space-for-total',
        title: 'Orders by Region',
        datasource: 'Sample - Superstore',
        fieldMapping: {
          field_base_1: '[Sample - Superstore].[none:Region:nk]',
          field_base_2: '[Sample - Superstore].[ctd:Order ID:qk]',
        },
      },
      executor,
    );

    expect(result.isError).toBe(true);
    expect(store.reserve('artifact-donut', '12345')).toEqual({ ok: false, reason: 'unknown' });
  });

  it('keeps the ordinary pie template available for explicit builds', async () => {
    const store = new TemplateArtifactStore({ capacity: 4 });
    const executor = makeExecutorMock({
      getWorkbookDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: SUPERSTORE_WORKBOOK,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
          instanceId: 'inst-build',
        }),
      ),
      applyWorkbookDocument: vi.fn(),
    });
    const tool = getBuildWorksheetsFromTemplatesTool(new DesktopMcpServer(), {
      store,
      createId: () => 'artifact-pie',
    });

    const result = await callTool(
      tool,
      {
        session: '12345',
        templateName: 'part-to-whole-pie-chart',
        title: 'Sales by Region',
        datasource: 'Sample - Superstore',
        fieldMapping: {
          field_base_1: '[Sample - Superstore].[none:Region:nk]',
          field_base_2: '[Sample - Superstore].[sum:Sales:qk]',
        },
      },
      executor,
    );

    expect(result.isError).toBe(false);
    expect(store.reserve('artifact-pie', '12345').ok).toBe(true);
  });

  it('keeps the unproven task-rollup Gantt template blocked', async () => {
    const store = new TemplateArtifactStore({ capacity: 4 });
    const executor = makeExecutorMock({
      getWorkbookDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: SUPERSTORE_WORKBOOK,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
          instanceId: 'inst-build',
        }),
      ),
      applyWorkbookDocument: vi.fn(),
    });
    const tool = getBuildWorksheetsFromTemplatesTool(new DesktopMcpServer(), {
      store,
      createId: () => 'artifact-gantt',
    });

    const result = await callTool(
      tool,
      {
        session: '12345',
        templateName: 'gantt-task-rollup-chart',
        title: 'Order Timeline',
        datasource: 'Sample - Superstore',
        fieldMapping: {
          field_base_1: '[Sample - Superstore].[none:Order ID:nk]',
          field_base_2: '[Sample - Superstore].[none:Order Date:ok]',
          field_base_3: '[Sample - Superstore].[none:Ship Date:ok]',
        },
      },
      executor,
    );

    expect(result.isError).toBe(true);
    expect(store.reserve('artifact-gantt', '12345')).toEqual({ ok: false, reason: 'unknown' });
  });

  it.each([
    {
      label: 'canonically equivalent Unicode',
      liveDatasource: '슈퍼스토어 - 샘플'.normalize('NFD'),
      requestedDatasource: '슈퍼스토어 - 샘플',
    },
    {
      label: 'one layer of outer brackets',
      liveDatasource: 'target.ds',
      requestedDatasource: '[target.ds]',
    },
  ])(
    'uses the live datasource identity when the requested name differs only by $label',
    async ({ liveDatasource, requestedDatasource }) => {
      const store = new TemplateArtifactStore({ capacity: 4 });
      const executor = makeExecutorMock({
        getWorkbookDocument: vi.fn().mockResolvedValue(
          Ok({
            xml: LIVE_WORKBOOK.replaceAll('target.ds', liveDatasource),
            applicationVersion: undefined,
            xsdPayloadVersion: undefined,
            instanceId: 'inst-build',
          }),
        ),
        applyWorkbookDocument: vi.fn(),
      });
      const tool = getBuildWorksheetsFromTemplatesTool(new DesktopMcpServer(), {
        store,
        createId: () => 'artifact-unicode',
      });

      const result = await callTool(
        tool,
        {
          ...EXACT_ARGS,
          datasource: requestedDatasource,
          fieldMapping: {
            field_base_1: `[${liveDatasource}].[none:Segment:nk]`,
            field_base_2: `[${liveDatasource}].[sum:Revenue:qk]`,
          },
        },
        executor,
      );

      expect(result.isError).toBe(false);
      expect(bodyOf(result).datasource).toBe(liveDatasource);
      const reserved = store.reserve('artifact-unicode', '12345');
      expect(reserved.ok).toBe(true);
      if (!reserved.ok) return;
      expect(reserved.artifact.datasource).toBe(liveDatasource);
      expect(reserved.artifact.worksheetXml).toContain(liveDatasource);
    },
  );

  it('rejects a case-different datasource name', async () => {
    const store = new TemplateArtifactStore({ capacity: 4 });
    const executor = makeExecutorMock({
      getWorkbookDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: LIVE_WORKBOOK,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
          instanceId: 'inst-build',
        }),
      ),
      applyWorkbookDocument: vi.fn(),
    });
    const tool = getBuildWorksheetsFromTemplatesTool(new DesktopMcpServer(), {
      store,
      createId: () => 'artifact-case-different',
    });

    const result = await callTool(tool, { ...EXACT_ARGS, datasource: 'TARGET.ds' }, executor);

    expect(result.isError).toBe(true);
    expect(store.reserve('artifact-case-different', '12345')).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });

  it('rejects bracket equivalence when raw and bracketed datasource names coexist', async () => {
    const store = new TemplateArtifactStore({ capacity: 4 });
    const ambiguousWorkbook = LIVE_WORKBOOK.replace(
      '</datasources>',
      `<datasource name='[target.ds]'>
        <column name='[Unrelated]' datatype='string' role='dimension' type='nominal'/>
      </datasource></datasources>`,
    );
    const executor = makeExecutorMock({
      getWorkbookDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: ambiguousWorkbook,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
          instanceId: 'inst-build',
        }),
      ),
      applyWorkbookDocument: vi.fn(),
    });
    const tool = getBuildWorksheetsFromTemplatesTool(new DesktopMcpServer(), {
      store,
      createId: () => 'artifact-ambiguous-datasource',
    });

    const result = await callTool(tool, { ...EXACT_ARGS, datasource: '[target.ds]' }, executor);

    expect(result.isError).toBe(true);
    expect(store.reserve('artifact-ambiguous-datasource', '12345')).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });

  it('still rejects a field mapping from a different datasource', async () => {
    const store = new TemplateArtifactStore({ capacity: 4 });
    const executor = makeExecutorMock({
      getWorkbookDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: LIVE_WORKBOOK,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
          instanceId: 'inst-build',
        }),
      ),
      applyWorkbookDocument: vi.fn(),
    });
    const tool = getBuildWorksheetsFromTemplatesTool(new DesktopMcpServer(), {
      store,
      createId: () => 'artifact-cross-datasource',
    });

    const result = await callTool(tool, { ...EXACT_ARGS, datasource: 'other.ds' }, executor);

    expect(result.isError).toBe(true);
    expect(store.reserve('artifact-cross-datasource', '12345')).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });

  it('keeps two previews built from the same live workbook independently available', async () => {
    const store = new TemplateArtifactStore({ capacity: 4 });
    const ids = ['artifact-A', 'artifact-B'];
    const executor = makeExecutorMock({
      getWorkbookDocument: vi.fn().mockResolvedValue(
        Ok({
          xml: LIVE_WORKBOOK,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
          instanceId: 'inst-build',
        }),
      ),
      applyWorkbookDocument: vi.fn(),
    });
    const tool = getBuildWorksheetsFromTemplatesTool(new DesktopMcpServer(), {
      store,
      createId: () => ids.shift()!,
    });

    expect((await callTool(tool, EXACT_ARGS, executor)).isError).toBe(false);
    expect(
      (await callTool(tool, { ...EXACT_ARGS, title: 'Revenue by Segment 2' }, executor)).isError,
    ).toBe(false);

    expect(store.reserve('artifact-A', '12345').ok).toBe(true);
    expect(store.reserve('artifact-B', '12345').ok).toBe(true);
  });

  it('applies A, then preserves A and an unrelated live edit while applying B', async () => {
    const server = new DesktopMcpServer();
    const store = new TemplateArtifactStore({ capacity: 4 });
    const ids = ['artifact-A', 'artifact-B'];
    const posts: string[] = [];
    let liveXml = LIVE_WORKBOOK;
    const executor = makeExecutorMock({
      getWorkbookDocument: vi.fn(async () =>
        Ok({
          xml: liveXml,
          applicationVersion: undefined,
          xsdPayloadVersion: undefined,
          instanceId: 'inst-build',
        }),
      ),
      applyWorkbookDocument: vi.fn(async (xml: string) => {
        posts.push(xml);
        liveXml = xml;
        return Ok({ command_id: 'apply', status: 'completed' as const, submitted_at: '' });
      }),
      executeCommand: vi
        .fn()
        .mockResolvedValue(Ok({ command_id: 'focus', status: 'completed', submitted_at: '' })),
    });
    const buildTool = getBuildWorksheetsFromTemplatesTool(server, {
      store,
      createId: () => ids.shift()!,
    });

    expect((await callTool(buildTool, EXACT_ARGS, executor)).isError).toBe(false);
    expect(
      (await callTool(buildTool, { ...EXACT_ARGS, title: 'Revenue by Segment 2' }, executor))
        .isError,
    ).toBe(false);

    const applyTool = getApplyWorksheetTool(server, { store });
    const apply = await Provider.from(applyTool.callback);
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(executor),
    };
    const appliedA = await apply(
      {
        session: '12345',
        artifactId: 'artifact-A',
        templatePlan: undefined,
        worksheetName: undefined,
        worksheetFile: undefined,
      },
      extra,
    );
    expect(appliedA).toMatchObject({ isError: false });

    liveXml = upsertSheetIntoWorkbook(
      liveXml,
      'Existing',
      '<worksheet name="Existing"><table><rows>external-live-edit</rows></table></worksheet>',
    );

    expect(
      (
        await apply(
          {
            session: '12345',
            artifactId: 'artifact-B',
            templatePlan: undefined,
            worksheetName: undefined,
            worksheetFile: undefined,
          },
          extra,
        )
      ).isError,
    ).toBe(false);

    expect(posts).toHaveLength(2);
    expect(posts[1]).toContain('name="Revenue by Segment"');
    expect(posts[1]).toContain('name="Revenue by Segment 2"');
    expect(posts[1]).toContain('external-live-edit');
  });
});

async function callTool(
  tool: ReturnType<typeof getBuildWorksheetsFromTemplatesTool>,
  args: {
    session: string;
    templateName: string;
    title: string;
    datasource: string;
    fieldMapping: Record<string, string>;
    topN?: number;
  },
  executor: ExternalApiToolExecutor,
): Promise<CallToolResult> {
  const callback = await Provider.from(tool.callback);
  return await callback(
    { ...args, topN: args.topN },
    {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(executor),
    },
  );
}

function bodyOf(result: CallToolResult): any {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}
