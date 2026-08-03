import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { resolve } from 'path';
import { Err, Ok } from 'ts-results-es';

import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getBuildWorksheetsFromTemplatesTool } from './buildWorksheetsFromTemplates.js';

vi.mock('../../../desktop/templates/templatePath.js');
vi.mock('../../../desktop/templates/injectTemplateCore.js');
vi.mock('../../../desktop/templates/templateSlots.js');
vi.mock('../../../desktop/binder/explicit-bind.js');
vi.mock('../../../desktop/binder/schema-summary.js');
vi.mock('../../../desktop/metadata/sheets.js');
vi.mock('../../../desktop/commands/workbook/loadWorksheetXml.js');
vi.mock('../../../desktop/sessionResolution.js');
vi.mock('../../../desktop/episode-events.js');
vi.mock('fs');

import { existsSync, readFileSync } from 'fs';

import {
  bindExplicitTemplate,
  formatExplicitBindErrors,
} from '../../../desktop/binder/explicit-bind.js';
import { summarizeSchema } from '../../../desktop/binder/schema-summary.js';
import { loadWorksheetXml } from '../../../desktop/commands/workbook/loadWorksheetXml.js';
import { extractSheetXml } from '../../../desktop/metadata/sheets.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { buildInjectedWorkbookXml } from '../../../desktop/templates/injectTemplateCore.js';
import { listTemplateNames, readTemplate } from '../../../desktop/templates/templatePath.js';
import {
  resolveAllTemplateManifests,
  resolveTemplateManifest,
} from '../../../desktop/templates/templateSlots.js';
import { TableauDesktopRequestHandlerExtra } from '../toolContext.js';

const SESSION = '12345';
const WORKBOOK_FILE = resolve('/cache/workbook.xml');
const WORKBOOK_XML = '<?xml version="1.0"?><workbook><worksheets/></workbook>';
const TEMPLATE_XML = '<workbook><worksheets><worksheet name="{{TITLE}}"/></worksheets></workbook>';
const BUILT_WORKBOOK_XML =
  '<?xml version="1.0"?><workbook><worksheets><worksheet name="My Bar"/></worksheets></workbook>';
const WORKSHEET_FRAGMENT = '<worksheet name="My Bar"><table/></worksheet>';
const DATASOURCE = 'Sample Superstore';
const MANIFESTS = new Map([['ranking-ordered-bar', { slots: [] } as any]]);
const RESOLVED_SLOTS = [
  { slot_id: 'measure', template_field: '{{field_base_1}}', derivation: 'sum' } as any,
];

const BASE_PARAMS = {
  session: SESSION,
  workbookFile: WORKBOOK_FILE,
  templateName: 'ranking-ordered-bar',
  title: 'My Bar',
  datasource: DATASOURCE,
  fieldMapping: { measure: '[Sample Superstore].[sum:Sales:qk]' },
  mode: 'buildAndReturn' as 'buildAndReturn' | 'buildAndApply',
  insertAfter: undefined as string | undefined,
};

function makeExtra(): TableauDesktopRequestHandlerExtra {
  const extra = getMockRequestHandlerExtra();
  extra.getExecutor = vi.fn().mockResolvedValue({});

  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue(WORKBOOK_XML);
  vi.mocked(readTemplate).mockReturnValue(TEMPLATE_XML);
  vi.mocked(listTemplateNames).mockReturnValue(['kpi-text', 'ranking-ordered-bar']);
  vi.mocked(summarizeSchema).mockReturnValue({} as any);
  vi.mocked(resolveAllTemplateManifests).mockReturnValue(MANIFESTS);
  vi.mocked(resolveTemplateManifest).mockReturnValue({
    manifest: { slots: RESOLVED_SLOTS } as any,
    source: 'inferred',
    fromBookmark: true,
  });
  vi.mocked(bindExplicitTemplate).mockReturnValue({
    ok: true,
    passthrough: false,
    datasource: DATASOURCE,
    fieldMapping: BASE_PARAMS.fieldMapping,
    optionalFieldPrunes: [],
    warnings: [],
  } as any);
  vi.mocked(formatExplicitBindErrors).mockReturnValue('BIND FAILED: bad mapping');
  vi.mocked(buildInjectedWorkbookXml).mockReturnValue({ ok: true, xml: BUILT_WORKBOOK_XML });
  vi.mocked(extractSheetXml).mockReturnValue(WORKSHEET_FRAGMENT);
  vi.mocked(resolveSession).mockReturnValue(Ok(SESSION));
  vi.mocked(loadWorksheetXml).mockResolvedValue(Ok({ readbackWarnings: [] }) as any);
  return extra;
}

describe('buildWorksheetsFromTemplatesTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a tool instance with the expected surface', () => {
    const tool = getBuildWorksheetsFromTemplatesTool(new DesktopMcpServer());
    expect(tool.name).toBe('build-worksheets-from-templates');
    expect(tool.annotations).toMatchObject({ readOnlyHint: false });
    expect(tool.paramsSchema).toMatchObject({
      workbookFile: expect.any(Object),
      templateName: expect.any(Object),
      title: expect.any(Object),
      datasource: expect.any(Object),
      fieldMapping: expect.any(Object),
      mode: expect.any(Object),
    });
  });

  it('buildAndReturn returns the built worksheet and does NOT touch the live workbook', async () => {
    const result = await getResult({ ...BASE_PARAMS, mode: 'buildAndReturn' });

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('ranking-ordered-bar');
    expect(result.content[0].text).toContain('My Bar');
    expect(result.content[0].text).toContain('NOT modified');
    expect(result.content[0].text).toContain(WORKSHEET_FRAGMENT);
    expect(loadWorksheetXml).not.toHaveBeenCalled();
  });

  it('buildAndApply upserts the EXTRACTED worksheet fragment through the apply seam', async () => {
    const result = await getResult({ ...BASE_PARAMS, mode: 'buildAndApply' });

    expect(result.isError).toBeFalsy();
    expect(extractSheetXml).toHaveBeenCalledWith(BUILT_WORKBOOK_XML, 'My Bar');
    expect(loadWorksheetXml).toHaveBeenCalledWith(
      expect.objectContaining({ worksheetName: 'My Bar', xml: WORKSHEET_FRAGMENT }),
    );
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('applied it to the live workbook');
  });

  it('is metadata-optional: hands the resolved catalog to the binder and inferred slots to the builder', async () => {
    await getResult(BASE_PARAMS);

    expect(bindExplicitTemplate).toHaveBeenCalledWith(
      'ranking-ordered-bar',
      BASE_PARAMS.fieldMapping,
      expect.anything(),
      expect.objectContaining({ manifests: MANIFESTS, datasource: DATASOURCE }),
    );
    expect(buildInjectedWorkbookXml).toHaveBeenCalledWith(
      expect.objectContaining({ templateSlots: RESOLVED_SLOTS }),
    );
  });

  it('returns an error listing available templates when the template is unknown', async () => {
    const extra = makeExtra();
    vi.mocked(readTemplate).mockReturnValue(null);

    const result = await getResult(BASE_PARAMS, extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('"ranking-ordered-bar" not found');
    expect(result.content[0].text).toContain('kpi-text');
    expect(loadWorksheetXml).not.toHaveBeenCalled();
  });

  it('returns an error when the workbook file does not exist', async () => {
    const extra = makeExtra();
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await getResult(BASE_PARAMS, extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not found');
  });

  it('surfaces binder failures and produces no worksheet', async () => {
    const extra = makeExtra();
    vi.mocked(bindExplicitTemplate).mockReturnValue({
      ok: false,
      errors: [{ code: 'x', message: 'bad' }],
    } as any);

    const result = await getResult(BASE_PARAMS, extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('BIND FAILED');
    expect(buildInjectedWorkbookXml).not.toHaveBeenCalled();
    expect(loadWorksheetXml).not.toHaveBeenCalled();
  });

  it('blocks when the resolved mapping datasource differs from the caller datasource', async () => {
    const extra = makeExtra();
    vi.mocked(bindExplicitTemplate).mockReturnValue({
      ok: true,
      passthrough: false,
      datasource: 'OTHER_DS',
      fieldMapping: BASE_PARAMS.fieldMapping,
      optionalFieldPrunes: [],
      warnings: [],
    } as any);

    const result = await getResult(BASE_PARAMS, extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('[datasource-mismatch]');
    expect(result.content[0].text).toContain('OTHER_DS');
    expect(buildInjectedWorkbookXml).not.toHaveBeenCalled();
  });

  it('returns an error and applies nothing when the core build fails', async () => {
    const extra = makeExtra();
    vi.mocked(buildInjectedWorkbookXml).mockReturnValue({
      ok: false,
      issues: ['unresolved {{field_base_1}}'],
    });

    const result = await getResult({ ...BASE_PARAMS, mode: 'buildAndApply' }, extra);

    expect(result.isError).toBe(true);
    expect(loadWorksheetXml).not.toHaveBeenCalled();
  });

  it('surfaces a load failure from the apply seam in buildAndApply', async () => {
    const extra = makeExtra();
    vi.mocked(loadWorksheetXml).mockResolvedValue(
      Err({ type: 'load-worksheet-xml-error', error: { type: 'invalid-xml' } }) as any,
    );

    const result = await getResult({ ...BASE_PARAMS, mode: 'buildAndApply' }, extra);

    expect(result.isError).toBe(true);
  });
});

async function getResult(params: typeof BASE_PARAMS, extra = makeExtra()): Promise<CallToolResult> {
  const tool = getBuildWorksheetsFromTemplatesTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(params as any, extra);
}
