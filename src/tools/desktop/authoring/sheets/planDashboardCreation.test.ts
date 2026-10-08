import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getPlanDashboardCreationTool } from './planDashboardCreation.js';

vi.mock('../../../../desktop/wrappers/getWorkbookXml.js');
vi.mock('../../../../desktop/metadata/index.js');
vi.mock('../../../../desktop/templates/templatePath.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../desktop/templates/templatePath.js')>()),
  listTemplateNames: vi.fn(),
}));

import { FieldResolution, resolveField } from '../../../../desktop/metadata/index.js';
import { listTemplateNames } from '../../../../desktop/templates/templatePath.js';
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import { TableauDesktopRequestHandlerExtra } from '../../toolContext.js';

const SESSION = 'session-1';

const SAMPLE_WORKBOOK_XML = `<?xml version="1.0" encoding="utf-8"?>
<workbook>
  <datasources>
    <datasource name="Sample Superstore" caption="Sample - Superstore">
      <column name="[Sales]" datatype="real" role="measure" type="quantitative"/>
      <column name="[Profit]" datatype="real" role="measure" type="quantitative"/>
      <column name="[Revenue]" datatype="real" role="measure" type="quantitative"/>
      <column name="[Category]" datatype="string" role="dimension" type="nominal"/>
    </datasource>
    <datasource name="ds1"><column name="[Profit]" datatype="real" role="measure" type="quantitative"/></datasource>
    <datasource name="ds2"><column name="[Profit]" datatype="real" role="measure" type="quantitative"/></datasource>
  </datasources>
  <worksheets/>
</workbook>`;

function makeExtra(workbookXml: string = SAMPLE_WORKBOOK_XML): TableauDesktopRequestHandlerExtra {
  const extra = getMockRequestHandlerExtra();
  extra.getExecutor = vi.fn().mockResolvedValue({});
  vi.mocked(getWorkbookXml).mockResolvedValue(new Ok(workbookXml));
  vi.mocked(listTemplateNames).mockReturnValue(['ranking-ordered-bar', 'kpi-text']);
  return extra;
}

function makeExactResolution(fieldName: string): FieldResolution {
  return {
    kind: 'exact' as const,
    column_ref:
      fieldName === 'Category'
        ? '[Sample Superstore].[none:Category:nk]'
        : `[Sample Superstore].[sum:${fieldName}:qk]`,
    datasource: 'Sample Superstore',
    query: fieldName,
  };
}

function extractPlan(result: CallToolResult): any {
  invariant(result.content[0].type === 'text');
  const marker = 'FULL PLAN (JSON):';
  const payload = JSON.parse(result.content[0].text) as { message: string };
  return JSON.parse(payload.message.slice(payload.message.indexOf(marker) + marker.length).trim());
}

describe('planDashboardCreationTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getPlanDashboardCreationTool(new DesktopMcpServer());
    expect(tool.name).toBe('plan-dashboard-creation');
    expect(tool.description).toContain('manual registration');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      dashboardName: expect.any(Object),
      worksheets: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({ readOnlyHint: true });
  });

  it('plans worksheet work but gates dashboard apply on manual registration and fresh caches', async () => {
    vi.mocked(resolveField).mockImplementation((_, query) => makeExactResolution(query));

    const result = await getResult({
      session: SESSION,
      dashboardName: 'My Dashboard',
      worksheets: [{ name: 'Sheet1', type: 'chart', fields: ['Sales', 'Category'] }],
    });

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('DASHBOARD CREATION PLAN');
    expect(result.content[0].text).toContain('batch-create-and-cache-sheets');
    expect(result.content[0].text).toContain('task_type');
    expect(result.content[0].text).toContain('ranking-ordered-bar');
    expect(result.content[0].text).toContain('AUTOMATIC COMPLETION BLOCKED');
    const plan = extractPlan(result);
    expect(plan.metadata.automaticCompletionSupported).toBe(false);
    expect(plan.phase2Parallel.tasks.map((task: any) => task.task_type)).toEqual(['worksheet']);
    expect(plan.phase3Registration).toMatchObject({
      required: true,
      kind: 'manual',
      dependsOn: 'phase2Parallel',
    });
    expect(plan.phase4Dashboard).toMatchObject({
      dependsOn: 'phase3Registration',
      tool: 'build-and-apply-dashboard',
    });
    expect(plan.phase4Dashboard.refreshCaches.map((step: any) => step.tool)).toEqual([
      'get-workbook-xml',
      'get-dashboard-xml',
    ]);
    expect(plan.phase4Dashboard.fileBinding).toContain('do not reuse the Phase 1 paths');
  });

  it.each(['avg', 'min', 'max', 'cnt', 'ctd'])(
    'preserves explicit %s in executable build arguments',
    async (derivation) => {
      vi.mocked(resolveField).mockImplementation((_, query) =>
        query === 'Category'
          ? makeExactResolution(query)
          : {
              kind: 'rewritten',
              query,
              datasource: 'Sample Superstore',
              column_ref: `[Sample Superstore].[${derivation}:Sales:qk]`,
              rewrites: ['parsed-aggregation-prefix'],
            },
      );
      const result = await getResult({
        session: SESSION,
        dashboardName: 'D',
        worksheets: [{ name: 'A', type: 'chart', fields: [`${derivation} of Sales`, 'Category'] }],
      });
      expect(result.isError).toBe(false);
      const params = extractPlan(result).phase2Parallel.tasks[0].build.params;
      expect(Object.values(params.derivationOverrides)).toContain(derivation);
      expect(Object.values(params.fieldMapping)).toContain(
        `[Sample Superstore].[${derivation}:Sales:qk]`,
      );
    },
  );

  it('does not require registration for an empty dashboard', async () => {
    const result = await getResult({ session: SESSION, dashboardName: 'Empty', worksheets: [] });
    expect(result.isError).toBeFalsy();
    const plan = extractPlan(result);
    expect(plan.metadata.automaticCompletionSupported).toBe(true);
    expect(plan.phase3Registration).toMatchObject({ required: false, status: 'ready' });
    expect(plan.phase2Parallel.tasks).toEqual([]);
  });

  it('should block planning when a field is ambiguous', async () => {
    vi.mocked(resolveField).mockReturnValue({
      kind: 'ambiguous',
      query: 'Sales',
      candidates: [
        {
          column_ref: '[DS1].[sum:Sales:qk]',
          datasource: 'DS1',
          column_name: 'Sales',
          role: 'measure',
          is_aggregated: false,
        },
        {
          column_ref: '[DS2].[sum:Sales:qk]',
          datasource: 'DS2',
          column_name: 'Sales',
          role: 'measure',
          is_aggregated: false,
        },
      ],
    });

    const result = await getResult({
      session: SESSION,
      dashboardName: 'My Dashboard',
      worksheets: [{ name: 'Sheet1', type: 'kpi', fields: ['Sales'] }],
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      [
        'BLOCKED: 1 ambiguous field reference — cannot plan dashboard',
        '',
        'Ambiguous (matches multiple columns — pick one):',
        '  • "Sales" → candidates: "[DS1].[sum:Sales:qk]", "[DS2].[sum:Sales:qk]"',
        '',
        'Next step: disambiguate each field, then re-call plan-dashboard-creation.',
        '  • Use resolve-field with an explicit datasource.',
        '  • For not_found fields, call list-available-fields to see valid names.',
        '  • Use ask-user to surface the choice to the user.',
      ].join('\n'),
    );
    // The structured block repeats the blocked text: a client that prefers structuredContent
    // never reads content[0], and "disambiguate each field" is useless without the list of
    // which fields were ambiguous.
    expect(result.structuredContent).toEqual({
      message: result.content[0].text,
      nextAction: { label: 'Disambiguate each field before re-planning', kind: 'prefill' },
    });
  });

  it('should include not_found fields in the blocked response alongside ambiguous', async () => {
    vi.mocked(resolveField).mockImplementation((_, fieldName) => {
      if (fieldName === 'Sales')
        return {
          kind: 'ambiguous' as const,
          query: fieldName,
          candidates: [
            {
              column_ref: '[DS1].[sum:Sales:qk]',
              datasource: 'DS1',
              column_name: 'Sales',
              role: 'measure',
              is_aggregated: false,
            },
          ],
        };
      return { kind: 'not_found' as const, query: fieldName };
    });

    const result = await getResult({
      session: SESSION,
      dashboardName: 'My Dashboard',
      worksheets: [{ name: 'Sheet1', type: 'chart', fields: ['Sales', 'Unknown'] }],
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('ambiguous');
    expect(result.content[0].text).toContain('not_found');
    expect(result.content[0].text).toContain('"Unknown"');
  });

  it('should block planning when only not_found fields are present', async () => {
    vi.mocked(resolveField).mockReturnValue({ kind: 'not_found', query: 'Unknown' });

    const result = await getResult({
      session: SESSION,
      dashboardName: 'My Dashboard',
      worksheets: [{ name: 'Sheet1', type: 'kpi', fields: ['Unknown'] }],
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('BLOCKED: 1 not_found field reference');
    expect(result.content[0].text).toContain('"Unknown"');
    expect(result.content[0].text).not.toContain('FULL PLAN (JSON):');
  });

  it('resolves object-shaped fields with datasource selectors and carries task datasource', async () => {
    vi.mocked(resolveField).mockImplementation((_, query, options) => ({
      kind: 'exact',
      query,
      column_ref: `[${options?.datasource}].[sum:${query}:qk]`,
      datasource: options?.datasource,
    }));

    const result = await getResult({
      session: SESSION,
      dashboardName: 'My Dashboard',
      worksheets: [
        { name: 'Sheet1', type: 'kpi', fields: [{ query: 'Profit', datasource: 'ds2' }] },
      ],
    });

    expect(result.isError).toBeFalsy();
    expect(resolveField).toHaveBeenCalledWith(SAMPLE_WORKBOOK_XML, 'Profit', {
      datasource: 'ds2',
    });
    const plan = extractPlan(result);
    const worksheetTask = plan.phase2Parallel.tasks.find((t: any) => t.task_type === 'worksheet');
    expect(Object.values(worksheetTask.build.params.fieldMapping)).toEqual([
      '[ds2].[sum:Profit:qk]',
    ]);
    expect(worksheetTask.build.params.datasource).toBe('ds2');
  });

  it('caches field resolution by query and datasource selector', async () => {
    vi.mocked(resolveField).mockImplementation((_, query, options) => ({
      kind: 'exact',
      query,
      column_ref: `[${options?.datasource}].[sum:${query}:qk]`,
      datasource: options?.datasource,
    }));

    const result = await getResult({
      session: SESSION,
      dashboardName: 'My Dashboard',
      worksheets: [
        { name: 'Sheet1', type: 'kpi', fields: [{ query: 'Profit', datasource: 'ds1' }] },
        { name: 'Sheet2', type: 'kpi', fields: [{ query: 'Profit', datasource: 'ds2' }] },
      ],
    });

    expect(result.isError).toBeFalsy();
    expect(resolveField).toHaveBeenCalledTimes(2);
    expect(resolveField).toHaveBeenNthCalledWith(1, SAMPLE_WORKBOOK_XML, 'Profit', {
      datasource: 'ds1',
    });
    expect(resolveField).toHaveBeenNthCalledWith(2, SAMPLE_WORKBOOK_XML, 'Profit', {
      datasource: 'ds2',
    });
    const plan = extractPlan(result);
    const worksheetTasks = plan.phase2Parallel.tasks.filter(
      (t: any) => t.task_type === 'worksheet',
    );
    expect(worksheetTasks.map((t: any) => Object.values(t.build.params.fieldMapping))).toEqual([
      ['[ds1].[sum:Profit:qk]'],
      ['[ds2].[sum:Profit:qk]'],
    ]);
    expect(worksheetTasks.map((t: any) => t.build.params.datasource)).toEqual(['ds1', 'ds2']);
  });

  it('should handle getWorkbookXml failure', async () => {
    const extra = getMockRequestHandlerExtra();
    extra.getExecutor = vi.fn().mockResolvedValue({});
    vi.mocked(getWorkbookXml).mockResolvedValue(
      new Err({
        type: 'command-failed' as const,
        error: { code: 'E1', message: 'fail', recoverable: false },
      }),
    );
    const result = await getResult(
      { session: SESSION, dashboardName: 'DB', worksheets: [] },
      extra,
    );
    expect(result.isError).toBe(true);
  });

  it('should select default template kpi-text for kpi worksheets', async () => {
    vi.mocked(resolveField).mockReturnValue(makeExactResolution('Revenue'));

    const result = await getResult({
      session: SESSION,
      dashboardName: 'My Dashboard',
      worksheets: [{ name: 'KPI Card', type: 'kpi', fields: ['Revenue'] }],
    });

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('kpi-text');
  });

  it.each([
    ['no fields', []],
    ['more than one field', ['Sales', 'Profit']],
  ])('should reject a KPI worksheet with %s before resolving anything', async (_, fields) => {
    const result = await getResult({
      session: SESSION,
      dashboardName: 'My Dashboard',
      worksheets: [{ name: 'Invalid KPI', type: 'kpi', fields }],
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'KPI worksheet "Invalid KPI" requires exactly one field',
    );
    expect(resolveField).not.toHaveBeenCalled();
    expect(getWorkbookXml).not.toHaveBeenCalled();
  });

  it('should recommend parallelization for 5+ worksheets', async () => {
    vi.mocked(resolveField).mockImplementation((_, query) => makeExactResolution(query));

    const worksheets = Array.from({ length: 5 }, (_, i) => ({
      name: `Sheet${i + 1}`,
      type: 'kpi' as const,
      fields: ['Sales'],
    }));

    const result = await getResult({
      session: SESSION,
      dashboardName: 'Big Dashboard',
      worksheets,
    });

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('PARALLELIZE');
    const plan = extractPlan(result);
    expect(plan.phase2Parallel.tasks).toHaveLength(5);
    expect(plan.phase2Parallel.tasks.every((task: any) => task.task_type === 'worksheet')).toBe(
      true,
    );
    expect(plan.metadata.recommendedParallelism).toBe(5);
    expect(result.content[0].text).toContain('Do not apply the dashboard in parallel');
  });

  it('should not recommend parallelization for fewer than 5 worksheets', async () => {
    vi.mocked(resolveField).mockImplementation((_, query) => makeExactResolution(query));

    const result = await getResult({
      session: SESSION,
      dashboardName: 'Small Dashboard',
      worksheets: [
        { name: 'Sheet1', type: 'kpi' as const, fields: ['Sales'] },
        { name: 'Sheet2', type: 'kpi' as const, fields: ['Sales'] },
      ],
    });

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).not.toContain('PARALLELIZE');
  });
});

async function getResult(
  params: {
    session: string;
    dashboardName: string;
    worksheets: {
      name: string;
      type: 'kpi' | 'chart';
      fields: Array<string | { query: string; datasource?: string }>;
      template?: string;
    }[];
    title?: string;
    layout?: any;
  },
  extra = makeExtra(),
): Promise<CallToolResult> {
  const tool = getPlanDashboardCreationTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(params as any, extra);
}
