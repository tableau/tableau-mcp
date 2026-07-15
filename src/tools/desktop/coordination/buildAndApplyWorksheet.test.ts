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
import { TableauDesktopRequestHandlerExtra } from '../toolContext.js';

const SESSION = 'session-1';
const FLAG = 'ROUTE_ENFORCEMENT';
const ORIGINAL_ROUTE_ENFORCEMENT = process.env[FLAG];

const WORKBOOK_XML = `<?xml version="1.0"?>
<workbook>
  <datasources>
    <datasource name="Sample Superstore" caption="Sample - Superstore"/>
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
  vi.mocked(loadWorksheetXml).mockResolvedValue(new Ok(undefined));
  return extra;
}

const TASK_SPEC_BASE = {
  worksheetName: 'Sheet1',
  worksheetFile: '/cache/worksheet.xml',
  type: 'chart' as const,
  template: 'ranking-ordered-bar',
  fields: ['[DS].[sum:Sales:qk]'],
  workbookFile: '/cache/workbook.xml',
};

describe('buildAndApplyWorksheetTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getBuildAndApplyWorksheetTool(new DesktopMcpServer());
    expect(tool.name).toBe('build-and-apply-worksheet');
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

  it('should call rewriteFieldReferences with template, fieldMapping, datasource name, and namespacing options', async () => {
    await getResult({ session: SESSION, taskSpec: TASK_SPEC_BASE });

    // CONVERGENCE: build-and-apply now calls the shared core (rewriteFieldReferences)
    // directly instead of the deleted replaceFieldReferences wrapper, so the call
    // gains a 5th arg: the per-apply options object wiring calc namespacing ON with a
    // caller-minted nonce. The first four args (template, mapping, datasource,
    // metadata) are unchanged.
    expect(rewriteFieldReferences).toHaveBeenCalledWith(
      TEMPLATE_XML,
      expect.any(Object),
      expect.stringMatching(/Sample/),
      expect.any(Object),
      { namespaceCalcs: true, applyNonce: expect.any(String) },
    );
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
