import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { resolve } from 'path';

import { removeSameNamedWorksheet } from '../../../desktop/templates/injectTemplateCore.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getInjectTemplateTool } from './injectTemplate.js';

vi.mock('../../../desktop/templates/injectTemplate.js');
vi.mock('../../../desktop/templates/fieldReferenceRewriter.js');
vi.mock('../../../desktop/templates/templatePath.js');
vi.mock('fs');

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';

import { rewriteFieldReferences } from '../../../desktop/templates/fieldReferenceRewriter.js';
import { injectTemplate } from '../../../desktop/templates/injectTemplate.js';
import { getTemplatePath, getTemplatesDir } from '../../../desktop/templates/templatePath.js';
import { TableauDesktopRequestHandlerExtra } from '../toolContext.js';

const WORKBOOK_FILE = resolve('/cache/workbook.xml');
const WORKBOOK_XML = '<?xml version="1.0"?><workbook><worksheets/></workbook>';
const TEMPLATE_XML =
  '<workbook><worksheets><worksheet name="{{TITLE}}"/></worksheets>' +
  '<windows><window class="worksheet" name="{{TITLE}}"/></windows></workbook>';
const INJECTED_XML =
  '<?xml version="1.0"?><workbook><worksheets><worksheet name="Sheet1"/></worksheets></workbook>';

const BASE_PARAMS = {
  workbookFile: WORKBOOK_FILE,
  templateName: 'ranking-ordered-bar',
  title: 'Sheet1',
  sheetType: 'worksheet' as const,
};

function makeExtra(): TableauDesktopRequestHandlerExtra {
  const extra = getMockRequestHandlerExtra();
  extra.getExecutor = vi.fn().mockResolvedValue({});
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockImplementation((p) => {
    if (String(p).includes('ranking')) return TEMPLATE_XML;
    return WORKBOOK_XML;
  });
  vi.mocked(writeFileSync).mockImplementation(() => {});
  vi.mocked(getTemplatePath).mockReturnValue('/templates/ranking-ordered-bar.xml');
  vi.mocked(getTemplatesDir).mockReturnValue('/templates');
  vi.mocked(readdirSync).mockReturnValue(['ranking-ordered-bar.xml', 'kpi-text.xml'] as any);
  vi.mocked(rewriteFieldReferences).mockReturnValue(TEMPLATE_XML);
  vi.mocked(injectTemplate).mockReturnValue(INJECTED_XML);
  return extra;
}

describe('injectTemplateTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getInjectTemplateTool(new DesktopMcpServer());
    expect(tool.name).toBe('inject-template');
    expect(tool.annotations).toMatchObject({ readOnlyHint: false });
    expect(tool.paramsSchema).toMatchObject({
      workbookFile: expect.any(Object),
      templateName: expect.any(Object),
      title: expect.any(Object),
      sheetType: expect.any(Object),
    });
  });

  it('should succeed and report injected sheet on happy path', async () => {
    const result = await getResult(BASE_PARAMS);

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('ranking-ordered-bar');
    expect(result.content[0].text).toContain('Sheet1');
    expect(result.content[0].text).toContain('apply-workbook');
  });

  it('should write modified XML back to the workbook file', async () => {
    await getResult(BASE_PARAMS);

    expect(writeFileSync).toHaveBeenCalledWith(resolve(WORKBOOK_FILE), INJECTED_XML, 'utf-8');
  });

  it('should return error when workbook file does not exist', async () => {
    const extra = makeExtra();
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await getResult(BASE_PARAMS, extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not found');
  });

  it('should return error listing available templates when template file does not exist', async () => {
    const extra = makeExtra();
    vi.mocked(existsSync).mockImplementation((p) => !String(p).includes('ranking'));

    const result = await getResult(BASE_PARAMS, extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('"ranking-ordered-bar" not found');
    expect(result.content[0].text).toContain('kpi-text');
  });

  it('should replace {{TITLE}} before injecting', async () => {
    const extra = makeExtra();
    let capturedTemplate = '';
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (String(p).includes('ranking')) return '{{TITLE}} template';
      return WORKBOOK_XML;
    });
    vi.mocked(injectTemplate).mockImplementation((_wb, tmpl) => {
      capturedTemplate = tmpl;
      return INJECTED_XML;
    });

    await getResult(BASE_PARAMS, extra);

    expect(capturedTemplate).toContain('Sheet1');
    expect(capturedTemplate).not.toContain('{{TITLE}}');
  });

  it('should call rewriteFieldReferences when DATASOURCE is in templateParameters', async () => {
    await getResult({
      ...BASE_PARAMS,
      templateParameters: { DATASOURCE: 'Sample Superstore' },
      fieldMapping: { Sales: '[sum:Sales:qk]' },
    });

    // CONVERGENCE: inject-template now calls the shared core (rewriteFieldReferences)
    // directly instead of the deleted replaceFieldReferences wrapper. The call gains
    // two trailing args over the wrapper's 3-arg form: fieldMetadata (undefined here)
    // and the per-apply options object that wires calc namespacing on with a nonce.
    expect(rewriteFieldReferences).toHaveBeenCalledWith(
      expect.any(String),
      { Sales: '[sum:Sales:qk]' },
      'Sample Superstore',
      undefined,
      { namespaceCalcs: true, applyNonce: expect.any(String) },
    );
  });

  it('should not call rewriteFieldReferences when no DATASOURCE is given', async () => {
    await getResult(BASE_PARAMS);

    expect(rewriteFieldReferences).not.toHaveBeenCalled();
  });

  it('should return error when injectTemplate throws', async () => {
    const extra = makeExtra();
    vi.mocked(injectTemplate).mockImplementation(() => {
      throw new Error('No <worksheets> container');
    });

    const result = await getResult(BASE_PARAMS, extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('No <worksheets> container');
  });

  it('should return error and not write when injected XML is malformed', async () => {
    const extra = makeExtra();
    vi.mocked(injectTemplate).mockReturnValue('<not valid xml <unclosed>');

    const result = await getResult(BASE_PARAMS, extra);

    expect(result.isError).toBe(true);
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it('should replace custom {{PLACEHOLDER}} from templateParameters', async () => {
    const extra = makeExtra();
    let capturedTemplate = '';
    vi.mocked(readFileSync).mockImplementation((p) => {
      if (String(p).includes('ranking')) return '{{SUBTITLE}} content';
      return WORKBOOK_XML;
    });
    vi.mocked(injectTemplate).mockImplementation((_wb, tmpl) => {
      capturedTemplate = tmpl;
      return INJECTED_XML;
    });

    await getResult({ ...BASE_PARAMS, templateParameters: { SUBTITLE: 'My Sub' } }, extra);

    expect(capturedTemplate).toContain('My Sub');
    expect(capturedTemplate).not.toContain('{{SUBTITLE}}');
  });
});

async function getResult(
  params: typeof BASE_PARAMS & {
    templateParameters?: Record<string, string>;
    fieldMapping?: Record<string, string>;
    insertPosition?: 'end' | 'before_sheet' | 'after_sheet';
    relativeSheetName?: string;
  },
  extra = makeExtra(),
): Promise<CallToolResult> {
  const tool = getInjectTemplateTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(params as any, extra);
}

describe('removeSameNamedWorksheet — demo idempotence (W60)', () => {
  const wb = `<workbook>
  <worksheets>
    <worksheet name='Keep Me'>
      <table><rows /></table>
    </worksheet>
    <worksheet name='Bar of Sales'>
      <table><rows>[old]</rows></table>
    </worksheet>
  </worksheets>
  <windows>
    <window class='worksheet' name='Bar of Sales'>
      <cards />
    </window>
    <window class='worksheet' name='Keep Me' />
  </windows>
</workbook>`;

  it('removes the same-named worksheet and its window so re-inject replaces instead of (1)-copying', () => {
    const out = removeSameNamedWorksheet(wb, 'Bar of Sales');
    expect(out).not.toContain("<worksheet name='Bar of Sales'>");
    expect(out).not.toContain("<window class='worksheet' name='Bar of Sales'>");
    expect(out).toContain("<worksheet name='Keep Me'>");
    expect(out).toContain("<window class='worksheet' name='Keep Me' />");
  });

  it('leaves the workbook unchanged when the sheet is referenced by a dashboard zone (fail-safe)', () => {
    const withDash = wb.replace(
      '</worksheets>',
      "</worksheets>\n  <dashboards><dashboard name='D'><zones><zone name='Bar of Sales' /></zones></dashboard></dashboards>",
    );
    expect(removeSameNamedWorksheet(withDash, 'Bar of Sales')).toBe(withDash);
  });

  it('no-ops when there is no name collision', () => {
    expect(removeSameNamedWorksheet(wb, 'Fresh Name')).toBe(wb);
  });
});
