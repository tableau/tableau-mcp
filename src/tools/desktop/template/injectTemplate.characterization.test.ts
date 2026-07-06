import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { resolve } from 'path';

import { DesktopMcpServer } from '../../../server.desktop.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getInjectTemplateTool } from './injectTemplate.js';

// CHARACTERIZATION SUITE — inject-template consumer of C (replaceFieldReferences).
// ------------------------------------------------------------------------------
// Pins the consumer-visible glue at injectTemplate.ts:140-155: HOW inject-template
// feeds C. `replaceFieldReferences` is mocked so we can capture EXACTLY what the
// consumer hands it (template string, mapping, datasource) and what it does with
// the result. These are the invariants a shared-rewriter swap must preserve.

vi.mock('../../../desktop/templates/injectTemplate.js');
vi.mock('../../../desktop/templates/replaceFieldReferences.js');
vi.mock('../../../desktop/templates/templatePath.js');
vi.mock('fs');

import { existsSync, readFileSync, writeFileSync } from 'fs';

import { injectTemplate } from '../../../desktop/templates/injectTemplate.js';
import { replaceFieldReferences } from '../../../desktop/templates/replaceFieldReferences.js';
import { getTemplatePath, getTemplatesDir } from '../../../desktop/templates/templatePath.js';
import { TableauDesktopRequestHandlerExtra } from '../toolContext.js';

const WORKBOOK_FILE = resolve('/cache/workbook.xml');
const WORKBOOK_XML = '<?xml version="1.0"?><workbook><worksheets/></workbook>';
// Template carries {{TITLE}}, a non-DATASOURCE placeholder ({{SUBTITLE}}), a bare
// {{DATASOURCE}} placeholder, and a field ref — exercising every substitution path.
const TEMPLATE_XML =
  "<workbook><worksheets><worksheet name='{{TITLE}}'>" +
  '<sub>{{SUBTITLE}}</sub>' +
  "<ds caption='{{DATASOURCE}}'/>" +
  "<enc column='[{{DATASOURCE}}].[sum:Sales:qk]'/>" +
  '</worksheet></worksheets>' +
  "<windows><window class='worksheet' name='{{TITLE}}'/></windows></workbook>";
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
  // Echo the (already placeholder-substituted) template so injectTemplate receives
  // a valid <worksheets>/<window> structure.
  vi.mocked(replaceFieldReferences).mockImplementation((xml) => xml);
  vi.mocked(injectTemplate).mockReturnValue(INJECTED_XML);
  return extra;
}

describe('injectTemplateTool — consumer glue characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes fieldMapping ?? {} — defaults to an empty mapping when none is given', async () => {
    await getResult({ ...BASE_PARAMS, templateParameters: { DATASOURCE: 'Sales Data' } });

    expect(replaceFieldReferences).toHaveBeenCalledTimes(1);
    expect(replaceFieldReferences).toHaveBeenCalledWith(expect.any(String), {}, 'Sales Data');
  });

  it('passes the DATASOURCE value to C RAW (unescaped) and skips it in the escaping loop', async () => {
    // DATASOURCE with XML-special chars: the generic templateParameters loop
    // `continue`s past DATASOURCE (no escapeXml), delegating it to C. SUBTITLE (a
    // normal placeholder) IS escaped by that loop.
    const extra = makeExtra();
    let capturedTemplate = '';
    let capturedDatasource = '';
    vi.mocked(replaceFieldReferences).mockImplementation((xml, _map, ds) => {
      capturedTemplate = xml;
      capturedDatasource = ds;
      return xml;
    });

    await getResult(
      {
        ...BASE_PARAMS,
        templateParameters: { DATASOURCE: 'A & B <co>', SUBTITLE: 'x & y' },
      },
      extra,
    );

    // DATASOURCE reaches C verbatim...
    expect(capturedDatasource).toBe('A & B <co>');
    // ...and {{DATASOURCE}} is still present in the template handed to C (the loop
    // did not substitute it — C is responsible for filling it).
    expect(capturedTemplate).toContain('{{DATASOURCE}}');
    // ...while the normal placeholder WAS escaped before C ran.
    expect(capturedTemplate).toContain('x &amp; y');
    expect(capturedTemplate).not.toContain('{{SUBTITLE}}');
  });

  it('substitutes and XML-escapes {{TITLE}} before handing the template to C', async () => {
    const extra = makeExtra();
    let capturedTemplate = '';
    vi.mocked(replaceFieldReferences).mockImplementation((xml) => {
      capturedTemplate = xml;
      return xml;
    });

    await getResult(
      { ...BASE_PARAMS, title: 'A < B & C', templateParameters: { DATASOURCE: 'DS' } },
      extra,
    );

    expect(capturedTemplate).toContain('A &lt; B &amp; C');
    expect(capturedTemplate).not.toContain('{{TITLE}}');
    expect(capturedTemplate).not.toContain('A < B & C');
  });

  it('CHARACTERIZATION: without a DATASOURCE param, C is never called and {{DATASOURCE}} survives into the injected XML', async () => {
    // CHARACTERIZATION: current behavior — {{DATASOURCE}} is filled ONLY by C, and C
    // runs ONLY when templateParameters.DATASOURCE is set. So a template with field
    // refs but no DATASOURCE param is injected with literal {{DATASOURCE}} still in
    // it (and no field remapping). The wellFormedXml check does not catch this.
    const extra = makeExtra();
    let injectedTemplate = '';
    vi.mocked(injectTemplate).mockImplementation((_wb, tmpl) => {
      injectedTemplate = tmpl;
      return INJECTED_XML;
    });

    await getResult({ ...BASE_PARAMS, fieldMapping: { Sales: '[DS].[sum:Sales:qk]' } }, extra);

    expect(replaceFieldReferences).not.toHaveBeenCalled();
    expect(injectedTemplate).toContain('{{DATASOURCE}}');
    expect(injectedTemplate).toContain('sum:Sales:qk');
  });
});

async function getResult(
  params: typeof BASE_PARAMS & {
    templateParameters?: Record<string, string>;
    fieldMapping?: Record<string, string>;
  },
  extra = makeExtra(),
): Promise<CallToolResult> {
  const tool = getInjectTemplateTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(params as any, extra);
}
