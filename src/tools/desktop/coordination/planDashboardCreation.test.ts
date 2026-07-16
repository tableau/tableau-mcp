import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getPlanDashboardCreationTool } from './planDashboardCreation.js';

vi.mock('../../../desktop/commands/workbook/getWorkbookXml.js');
vi.mock('../../../desktop/metadata/index.js');
vi.mock('../../../desktop/templates/templatePath.js');
vi.mock('fs');

import { existsSync, readdirSync } from 'fs';

import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { FieldResolution, resolveField } from '../../../desktop/metadata/index.js';
import { getTemplatesDir } from '../../../desktop/templates/templatePath.js';
import { TableauDesktopRequestHandlerExtra } from '../toolContext.js';
import { isPlanBuildWorksheet, resetPlanBuildWorksheets } from './planBuildFocus.js';

const SESSION = 'session-1';

const SAMPLE_WORKBOOK_XML = `<?xml version="1.0" encoding="utf-8"?>
<workbook>
  <datasources>
    <datasource name="Sample Superstore" caption="Sample - Superstore"/>
  </datasources>
  <worksheets/>
</workbook>`;

function makeExtra(workbookXml: string = SAMPLE_WORKBOOK_XML): TableauDesktopRequestHandlerExtra {
  const extra = getMockRequestHandlerExtra();
  extra.getExecutor = vi.fn().mockResolvedValue({});
  vi.mocked(getWorkbookXml).mockResolvedValue(new Ok(workbookXml));
  vi.mocked(getTemplatesDir).mockReturnValue('/tmp/templates');
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readdirSync).mockReturnValue(['ranking-ordered-bar.xml', 'kpi-text.xml'] as any);
  return extra;
}

function makeExactResolution(fieldName: string): FieldResolution {
  return {
    kind: 'exact' as const,
    column_ref: `[Sample - Superstore].[sum:${fieldName}:qk]`,
    datasource: 'Sample Superstore',
    query: fieldName,
  };
}

describe('planDashboardCreationTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getPlanDashboardCreationTool(new DesktopMcpServer());
    expect(tool.name).toBe('plan-dashboard-creation');
    expect(tool.description).toContain('parallel');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      dashboardName: expect.any(Object),
      worksheets: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({ readOnlyHint: true });
  });

  it('should return a plan with phase1 and phase2 on success', async () => {
    vi.mocked(resolveField).mockReturnValue(makeExactResolution('Sales'));

    const result = await getResult({
      session: SESSION,
      dashboardName: 'My Dashboard',
      worksheets: [{ name: 'Sheet1', type: 'chart', fields: ['Sales'] }],
    });

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('DASHBOARD CREATION PLAN');
    expect(result.content[0].text).toContain('batch-create-and-cache-sheets');
    expect(result.content[0].text).toContain('task_type');
    expect(result.content[0].text).toContain('ranking-ordered-bar');
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
      worksheets: [{ name: 'Sheet1', type: 'chart', fields: ['Sales'] }],
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
    expect(result.structuredContent).toEqual({
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

  it('should handle getWorkbookXml failure', async () => {
    const extra = getMockRequestHandlerExtra();
    extra.getExecutor = vi.fn().mockResolvedValue({});
    vi.mocked(getWorkbookXml).mockResolvedValue(
      new Err({
        type: 'command-failed' as const,
        error: { code: 'E1', message: 'fail', recoverable: false },
      }),
    );
    vi.mocked(getTemplatesDir).mockReturnValue('/tmp/templates');
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockReturnValue([]);

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

  it('should recommend parallelization for 5+ worksheets', async () => {
    vi.mocked(resolveField).mockReturnValue(makeExactResolution('Sales'));

    const worksheets = Array.from({ length: 5 }, (_, i) => ({
      name: `Sheet${i + 1}`,
      type: 'chart' as const,
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
  });

  it('should not recommend parallelization for fewer than 5 worksheets', async () => {
    vi.mocked(resolveField).mockReturnValue(makeExactResolution('Sales'));

    const result = await getResult({
      session: SESSION,
      dashboardName: 'Small Dashboard',
      worksheets: [
        { name: 'Sheet1', type: 'chart' as const, fields: ['Sales'] },
        { name: 'Sheet2', type: 'chart' as const, fields: ['Sales'] },
      ],
    });

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).not.toContain('PARALLELIZE');
  });
});

// Compose-focus seam (a2td #215 port): the plan tool records every planned worksheet name for
// its session so build-and-apply-worksheet can suppress per-sheet focus (final dashboard apply
// owns it). Names outside the plan, and other sessions, stay standalone (unrecorded).
describe('planDashboardCreationTool — records plan worksheets for focus suppression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPlanBuildWorksheets();
  });

  afterEach(() => {
    resetPlanBuildWorksheets();
  });

  it('registers every planned worksheet name (and leaves standalone names / other sessions unrecorded)', async () => {
    vi.mocked(resolveField).mockReturnValue(makeExactResolution('Sales'));

    const result = await getResult({
      session: 'plan-session',
      dashboardName: 'Exec Dashboard',
      worksheets: [
        { name: 'Sales by Region', type: 'chart', fields: ['Sales'] },
        { name: 'Profit KPI', type: 'kpi', fields: ['Sales'] },
      ],
    });

    expect(result.isError).toBeFalsy();
    expect(isPlanBuildWorksheet('plan-session', 'Sales by Region')).toBe(true);
    expect(isPlanBuildWorksheet('plan-session', 'Profit KPI')).toBe(true);
    // A name that was not part of the plan, and a different session, stay standalone.
    expect(isPlanBuildWorksheet('plan-session', 'Some Other Sheet')).toBe(false);
    expect(isPlanBuildWorksheet('different-session', 'Sales by Region')).toBe(false);
  });

  it('does not record any worksheet when planning is BLOCKED on an ambiguous field', async () => {
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
      session: 'plan-session',
      dashboardName: 'Blocked Dashboard',
      worksheets: [{ name: 'Sales by Region', type: 'chart', fields: ['Sales'] }],
    });

    expect(result.isError).toBe(true);
    // Planning bailed before building tasks, so nothing is recorded — a later standalone apply
    // of this name must still focus.
    expect(isPlanBuildWorksheet('plan-session', 'Sales by Region')).toBe(false);
  });
});

async function getResult(
  params: {
    session: string;
    dashboardName: string;
    worksheets: { name: string; type: 'kpi' | 'chart'; fields: string[]; template?: string }[];
    title?: string;
    layout?: any;
  },
  extra = makeExtra(),
): Promise<CallToolResult> {
  const tool = getPlanDashboardCreationTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(params as any, extra);
}
