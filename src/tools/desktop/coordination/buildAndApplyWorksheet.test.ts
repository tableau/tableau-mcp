import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getBuildAndApplyWorksheetTool } from './buildAndApplyWorksheet.js';

vi.mock('../../../desktop/commands/workbook/loadWorksheetXml.js');
vi.mock('../../../desktop/metadata/index.js');
vi.mock('../../../desktop/templates/fieldReferenceRewriter.js');
vi.mock('../../../desktop/templates/templateColumnRequirements.js');
vi.mock('../../../desktop/templates/templatePath.js');
vi.mock('fs');

import { existsSync, readFileSync } from 'fs';

import { loadWorksheetXml } from '../../../desktop/commands/workbook/loadWorksheetXml.js';
import { listAvailableFields } from '../../../desktop/metadata/index.js';
import { deflectionText } from '../../../desktop/route/route-gate.js';
import { sessionRouteState } from '../../../desktop/route/route-state.js';
import { rewriteFieldReferences } from '../../../desktop/templates/fieldReferenceRewriter.js';
import { getTemplateColumnRequirements } from '../../../desktop/templates/templateColumnRequirements.js';
import { readTemplate } from '../../../desktop/templates/templatePath.js';
import type { ReadbackFinding } from '../../../desktop/validation/readback-verify.js';
import { TableauDesktopRequestHandlerExtra } from '../toolContext.js';
import { markPlanBuildWorksheets, resetPlanBuildWorksheets } from './planBuildFocus.js';

const SESSION = 'session-1';
const FLAG = 'ROUTE_ENFORCEMENT';
const ORIGINAL_ROUTE_ENFORCEMENT = process.env[FLAG];

const WORKBOOK_XML = `<?xml version="1.0"?>
<workbook>
  <datasources>
    <datasource name="Sample Superstore" caption="Sample - Superstore"/>
  </datasources>
</workbook>`;

const TWO_DATASOURCE_WORKBOOK_XML = `<?xml version="1.0"?>
<workbook>
  <datasources>
    <datasource name="DS_A" caption="First Caption"/>
    <datasource name="DS_B"/>
  </datasources>
</workbook>`;

const TEMPLATE_XML =
  '<workbook><worksheets><worksheet name="TEMPLATE"><table/></worksheet></worksheets></workbook>';

function makeExtra(): TableauDesktopRequestHandlerExtra {
  const extra = getMockRequestHandlerExtra();
  extra.getExecutor = vi.fn().mockResolvedValue({});
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue(WORKBOOK_XML as any);
  vi.mocked(readTemplate).mockReturnValue(TEMPLATE_XML);
  vi.mocked(listAvailableFields).mockReturnValue([
    {
      column_ref: '[DS].[sum:Sales:qk]',
      role: 'measure',
      datasource: 'Sample Superstore',
      columnName: '[Sales]',
      columnInstanceName: '[sum:Sales:qk]',
      derivation: 'Sum' as any,
      type: 'quantitative',
      datatype: 'integer',
    },
  ]);
  vi.mocked(getTemplateColumnRequirements).mockReturnValue([
    { name: 'Sales', role: 'measure', datatype: 'integer', type: 'quantitative' },
  ]);
  vi.mocked(rewriteFieldReferences).mockReturnValue(TEMPLATE_XML);
  vi.mocked(loadWorksheetXml).mockResolvedValue(new Ok({ readbackWarnings: [] }));
  return extra;
}

function twoDatasourceFields(): any[] {
  return [
    {
      column_ref: '[DS_A].[none:Region:nk]',
      role: 'dimension',
      datasource: 'DS_A',
      columnName: '[Region]',
      columnInstanceName: '[none:Region:nk]',
      derivation: 'None' as any,
      type: 'nominal',
      datatype: 'string',
    },
    {
      column_ref: '[DS_B].[none:Region:nk]',
      role: 'dimension',
      datasource: 'DS_B',
      columnName: '[Region]',
      columnInstanceName: '[none:Region:nk]',
      derivation: 'None' as any,
      type: 'nominal',
      datatype: 'string',
    },
    {
      column_ref: '[DS_B].[sum:Sales:qk]',
      role: 'measure',
      datasource: 'DS_B',
      columnName: '[Sales]',
      columnInstanceName: '[sum:Sales:qk]',
      derivation: 'Sum' as any,
      type: 'quantitative',
      datatype: 'integer',
    },
  ];
}

const TASK_SPEC_BASE = {
  worksheetName: 'Sheet1',
  worksheetFile: '/cache/worksheet.xml',
  type: 'chart' as const,
  template: 'ranking-ordered-bar',
  fields: ['[DS].[sum:Sales:qk]'],
  workbookFile: '/cache/workbook.xml',
};

const promisedSortLossWarning: ReadbackFinding = {
  kind: 'sort',
  node: 'shelf-sort-v2',
  column: '[DS].[none:Region:nk]',
  intended: '<shelf-sort-v2 column="[DS].[none:Region:nk]">',
  readback: 'changed',
  severity: 'warning',
};

describe('buildAndApplyWorksheetTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getBuildAndApplyWorksheetTool(new DesktopMcpServer());
    expect(tool.name).toBe('build-and-apply-worksheet');
    expect(tool.description).toBe(
      'Build a worksheet from a spec and apply it in one validated call — the one-shot manual path when no template binds.',
    );
    expect(tool.annotations).toMatchObject({ readOnlyHint: false });
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      taskSpec: expect.any(Object),
    });
  });

  it('should succeed and apply worksheet on happy path', async () => {
    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE });

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Sheet1');
    expect(result.content[0].text).toContain('ranking-ordered-bar');
    expect(result.content[0].text).toContain('HOST VERIFICATION');
  });

  it('reports skipped readback caveat when apply succeeds without verification', async () => {
    const extra = makeExtra();
    vi.mocked(loadWorksheetXml).mockResolvedValue(
      new Ok({
        readbackWarnings: [],
        readbackVerification: { ok: true, status: 'skipped', message: 'worksheet busy' },
      }),
    );

    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE }, extra);

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('HOST VERIFICATION — unverified');
    expect(result.content[0].text).toContain('readback unavailable');
    expect(result.content[0].text).not.toMatch(/\bverified\b/i);
  });

  it('fails the receipt when readback warnings show promised sort loss', async () => {
    const extra = makeExtra();
    vi.mocked(loadWorksheetXml).mockResolvedValue(
      new Ok({
        readbackWarnings: [promisedSortLossWarning],
        readbackVerification: { ok: true, status: 'warning' },
      }),
    );

    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE }, extra);

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('HOST VERIFICATION — failed');
    expect(result.content[0].text).toContain('promised sort NOT verified');
    expect(result.content[0].text).not.toContain('HOST VERIFICATION — verified');
  });

  it('should return error when workbook file does not exist', async () => {
    const extra = makeExtra();
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE }, extra);
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('workbook.xml');
  });

  it('should return error when template is not provided', async () => {
    const result = await getResult({
      session: SESSION,
      taskSpec: { ...TASK_SPEC_BASE, template: '' },
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('template is required');
  });

  it('should return error when template file does not exist', async () => {
    const extra = makeExtra();
    vi.mocked(readTemplate).mockReturnValue(null);

    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE }, extra);
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Template not found');
  });

  it('should return error when loadWorksheetXml fails', async () => {
    const extra = makeExtra();
    vi.mocked(loadWorksheetXml).mockResolvedValue(
      new Err({
        type: 'execute-command-error',
        error: {
          type: 'command-failed' as const,
          error: { code: 'E1', message: 'fail', recoverable: false },
        },
      }),
    );

    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE }, extra);
    expect(result.isError).toBe(true);
  });

  it('should call rewriteFieldReferences with template, fieldMapping, resolved datasource, and namespacing options', async () => {
    await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE });

    // CONVERGENCE: build-and-apply now calls the shared core (rewriteFieldReferences)
    // directly instead of the deleted replaceFieldReferences wrapper, so the call
    // gains a 5th arg: the per-apply options object wiring calc namespacing ON with a
    // caller-minted nonce. Seam-1 packet B changes the datasource arg to the resolved
    // bind datasource instead of the workbook caption.
    expect(rewriteFieldReferences).toHaveBeenCalledWith(
      TEMPLATE_XML,
      expect.any(Object),
      'DS',
      expect.any(Object),
      { namespaceCalcs: true, applyNonce: expect.any(String) },
    );
  });

  it('uses the explicit bind datasource for manifest-backed rewrites', async () => {
    const extra = makeExtra();
    vi.mocked(readFileSync).mockReturnValue(TWO_DATASOURCE_WORKBOOK_XML as any);
    vi.mocked(listAvailableFields).mockReturnValue(twoDatasourceFields() as any);
    vi.mocked(getTemplateColumnRequirements).mockReturnValue([
      { name: 'Region', role: 'dimension', datatype: 'string', type: 'nominal' },
      { name: 'Sales', role: 'measure', datatype: 'integer', type: 'quantitative' },
    ]);

    const result = await getResult(
      {
        session: SESSION,
        taskSpec: {
          ...TASK_SPEC_BASE,
          fields: ['[DS_B].[none:Region:nk]', '[DS_B].[sum:Sales:qk]'],
        },
      },
      extra,
    );

    expect(result.isError).toBeFalsy();
    expect(rewriteFieldReferences).toHaveBeenCalledWith(
      TEMPLATE_XML,
      expect.any(Object),
      'DS_B',
      expect.any(Object),
      { namespaceCalcs: true, applyNonce: expect.any(String) },
    );
  });

  it('blocks no-manifest passthrough when provided refs span datasources', async () => {
    const extra = makeExtra();
    vi.mocked(readFileSync).mockReturnValue(TWO_DATASOURCE_WORKBOOK_XML as any);
    vi.mocked(readTemplate).mockReturnValue(TEMPLATE_XML);
    vi.mocked(listAvailableFields).mockReturnValue(twoDatasourceFields() as any);
    vi.mocked(getTemplateColumnRequirements).mockReturnValue([
      { name: 'Region', role: 'dimension', datatype: 'string', type: 'nominal' },
      { name: 'Sales', role: 'measure', datatype: 'integer', type: 'quantitative' },
    ]);

    const result = await getResult(
      {
        session: SESSION,
        taskSpec: {
          ...TASK_SPEC_BASE,
          template: 'loose-template-without-manifest',
          fields: ['[DS_A].[none:Region:nk]', '[DS_B].[sum:Sales:qk]'],
        },
      },
      extra,
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('BLOCKED: mixed-datasource field references');
    expect(result.content[0].text).toContain('DS_A');
    expect(result.content[0].text).toContain('DS_B');
    expect(rewriteFieldReferences).not.toHaveBeenCalled();
    expect(loadWorksheetXml).not.toHaveBeenCalled();
  });

  it('should return error when extracted worksheet element is missing from template', async () => {
    const extra = makeExtra();
    vi.mocked(rewriteFieldReferences).mockReturnValue('<workbook>no worksheet here</workbook>');

    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE }, extra);
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('<worksheet>');
  });
});

// Compose-focus seam (a2td #215 port): build-and-apply-worksheet suppresses its per-sheet
// focus only for worksheets recorded by a multi-task plan (session+name scoped), so the final
// dashboard apply owns focus. Standalone applies keep focusing.
describe('buildAndApplyWorksheetTool — plan-build focus suppression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPlanBuildWorksheets();
  });

  afterEach(() => {
    resetPlanBuildWorksheets();
  });

  it('does NOT suppress focus for a standalone apply (no plan recorded)', async () => {
    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE });

    expect(result.isError).toBeFalsy();
    expect(loadWorksheetXml).toHaveBeenCalledWith(
      expect.objectContaining({ worksheetName: 'Sheet1', suppressFocus: false }),
    );
  });

  it('suppresses focus when the (session, worksheet) was recorded by a plan', async () => {
    markPlanBuildWorksheets(SESSION, ['Sheet1']);

    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE });

    expect(result.isError).toBeFalsy();
    expect(loadWorksheetXml).toHaveBeenCalledWith(
      expect.objectContaining({ worksheetName: 'Sheet1', suppressFocus: true }),
    );
  });

  it('does NOT suppress focus when the plan was recorded for a DIFFERENT session', async () => {
    markPlanBuildWorksheets('other-session', ['Sheet1']);

    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE });

    expect(result.isError).toBeFalsy();
    expect(loadWorksheetXml).toHaveBeenCalledWith(
      expect.objectContaining({ worksheetName: 'Sheet1', suppressFocus: false }),
    );
  });
});

describe('buildAndApplyWorksheetTool — route gate (ROUTE_ENFORCEMENT)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionRouteState.clear();
    delete process.env[FLAG];
  });

  afterEach(() => {
    sessionRouteState.clear();
    if (ORIGINAL_ROUTE_ENFORCEMENT === undefined) delete process.env[FLAG];
    else process.env[FLAG] = ORIGINAL_ROUTE_ENFORCEMENT;
  });

  function seedPendingBindFirst(): void {
    sessionRouteState.recordAskClassification(SESSION, {
      ask: 'bar chart of sales by region',
      route: 'bind-first',
      shape: 'bind-first-template',
      template: 'ranking-ordered-bar',
    });
  }

  it('flag off executes normally even with a pending current_ask', async () => {
    seedPendingBindFirst();

    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE });

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Sheet1');
    expect(loadWorksheetXml).toHaveBeenCalledTimes(1);
  });

  it('flag on returns the deflection before reading workbook XML or applying worksheet', async () => {
    process.env[FLAG] = 'on';
    seedPendingBindFirst();

    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(deflectionText('ranking-ordered-bar'));
    invariant(result.content[1].type === 'text');
    expect(JSON.parse(result.content[1].text)).toEqual({
      next_route: 'bind-first',
      template: 'ranking-ordered-bar',
    });
    expect(readFileSync).not.toHaveBeenCalled();
    expect(loadWorksheetXml).not.toHaveBeenCalled();
  });

  it('flag on deflects once, then an identical second call executes normally', async () => {
    process.env[FLAG] = 'on';
    seedPendingBindFirst();

    const first = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE });
    const second = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE });

    expect(first.isError).toBe(false);
    invariant(first.content[0].type === 'text');
    expect(first.content[0].text).toBe(deflectionText('ranking-ordered-bar'));
    expect(second.isError).toBeFalsy();
    invariant(second.content[0].type === 'text');
    expect(second.content[0].text).toContain('Sheet1');
    expect(loadWorksheetXml).toHaveBeenCalledTimes(1);
  });

  it('flag on with no current_ask executes normally', async () => {
    process.env[FLAG] = 'on';

    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE });

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Sheet1');
    expect(loadWorksheetXml).toHaveBeenCalledTimes(1);
  });

  it('flag on with an already-concluded current_ask executes normally', async () => {
    process.env[FLAG] = 'on';
    seedPendingBindFirst();
    sessionRouteState.recordAskOutcome(SESSION, 'bar chart of sales by region', 'bound');

    const result = await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE });

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Sheet1');
    expect(loadWorksheetXml).toHaveBeenCalledTimes(1);
  });
});

async function getResult(
  params: { session: string; taskSpec: typeof TASK_SPEC_BASE & { template?: string } },
  extra = makeExtra(),
): Promise<CallToolResult> {
  const tool = getBuildAndApplyWorksheetTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(params as any, extra);
}
