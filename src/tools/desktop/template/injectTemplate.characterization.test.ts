import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { resolve } from 'path';

import { DesktopMcpServer } from '../../../server.desktop.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getInjectTemplateTool } from './injectTemplate.js';

// CHARACTERIZATION SUITE — inject-template consumer of the shared rewriter.
// ------------------------------------------------------------------------------
// Pins the consumer-visible glue in injectTemplate.ts: HOW inject-template feeds
// the rewriter. W14-CM1 migrated this consumer OFF the deleted replaceFieldReferences
// wrapper and onto the shared core (`rewriteFieldReferences`); the core is mocked so
// we can capture EXACTLY what the consumer hands it (template string, mapping,
// datasource, metadata, options) and what it does with the result. These are the
// invariants the migration had to preserve.

vi.mock('../../../desktop/templates/injectTemplate.js');
vi.mock('../../../desktop/templates/fieldReferenceRewriter.js');
vi.mock('../../../desktop/templates/templatePath.js');
vi.mock('../../../desktop/commands/workbook/cacheFingerprint.js');
vi.mock('../../../desktop/intelligence/provider.js', () => ({
  bundledIntelligenceProvider: { getTemplateManifest: vi.fn() },
}));
vi.mock('fs');

import { existsSync, readFileSync, writeFileSync } from 'fs';

import { bundledIntelligenceProvider } from '../../../desktop/intelligence/provider.js';
import { rewriteFieldReferences } from '../../../desktop/templates/fieldReferenceRewriter.js';
import { injectTemplate } from '../../../desktop/templates/injectTemplate.js';
import { listTemplateNames, readTemplate } from '../../../desktop/templates/templatePath.js';
import { TableauDesktopRequestHandlerExtra } from '../toolContext.js';

const WORKBOOK_FILE = resolve('/cache/workbook.xml');
const SESSION = '12345';
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
  session: SESSION,
  workbookFile: WORKBOOK_FILE,
  templateName: 'ranking-ordered-bar',
  title: 'Sheet1',
  sheetType: 'worksheet' as const,
};

function makeExtra(): TableauDesktopRequestHandlerExtra {
  const extra = getMockRequestHandlerExtra();
  extra.getExecutor = vi.fn().mockResolvedValue({});
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFileSync).mockReturnValue(WORKBOOK_XML);
  vi.mocked(writeFileSync).mockImplementation(() => {});
  vi.mocked(readTemplate).mockReturnValue(TEMPLATE_XML);
  vi.mocked(listTemplateNames).mockReturnValue(['kpi-text', 'ranking-ordered-bar']);
  vi.mocked(bundledIntelligenceProvider.getTemplateManifest).mockReturnValue(undefined);
  // Echo the (already placeholder-substituted) template so injectTemplate receives
  // a valid <worksheets>/<window> structure.
  vi.mocked(rewriteFieldReferences).mockImplementation((xml) => xml);
  vi.mocked(injectTemplate).mockReturnValue(INJECTED_XML);
  return extra;
}

describe('injectTemplateTool — consumer glue characterization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes fieldMapping ?? {} — defaults to an empty mapping when none is given', async () => {
    await getResult({ ...BASE_PARAMS, templateParameters: { DATASOURCE: 'Sales Data' } });

    expect(rewriteFieldReferences).toHaveBeenCalledTimes(1);
    // CONVERGENCE: the consumer now calls the shared core directly (W14-CM1), so the
    // call carries the core's full arity — the same (template, {}, datasource) it
    // always did, PLUS fieldMetadata (undefined here) and the per-apply options that
    // turn calc namespacing ON with a caller-minted nonce. The empty-mapping default
    // is unchanged.
    expect(rewriteFieldReferences).toHaveBeenCalledWith(
      expect.any(String),
      {},
      'Sales Data',
      undefined,
      {
        namespaceCalcs: true,
        applyNonce: expect.any(String),
        templateSlots: undefined,
      },
    );
  });

  it('passes the DATASOURCE value to C RAW (unescaped) and skips it in the escaping loop', async () => {
    // DATASOURCE with XML-special chars: the generic templateParameters loop
    // `continue`s past DATASOURCE (no escapeXml), delegating it to C. SUBTITLE (a
    // normal placeholder) IS escaped by that loop.
    const extra = makeExtra();
    let capturedTemplate = '';
    let capturedDatasource = '';
    vi.mocked(rewriteFieldReferences).mockImplementation((xml, _map, ds) => {
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
    vi.mocked(rewriteFieldReferences).mockImplementation((xml) => {
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

  it('blocks a manifest-backed template when DATASOURCE is missing', async () => {
    const extra = makeExtra();
    vi.mocked(bundledIntelligenceProvider.getTemplateManifest).mockReturnValue({
      slots: [
        {
          template_field: 'Sales',
          required: true,
          bindable: true,
          kind: 'quantitative',
          role: ['cols'],
        },
      ],
    } as any);
    const result = await getResult(
      { ...BASE_PARAMS, fieldMapping: { Sales: '[DS].[sum:Sales:qk]' } },
      extra,
    );

    expect(result.isError).toBe(true);
    expect(rewriteFieldReferences).not.toHaveBeenCalled();
    expect(injectTemplate).not.toHaveBeenCalled();
    expect(result.content[0]).toEqual(
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('provide a datasource and choose every required chart field'),
      }),
    );
  });

  it('CONVERGENCE: wires per-apply calc namespacing ON with a DISTINCT nonce per apply', async () => {
    // CONVERGENCE: W14-CM1 wires calc namespacing at this tool boundary. The pure core
    // defaults namespacing OFF and never mints its own nonce, so inject-template passes
    // { namespaceCalcs: true, applyNonce } on every apply. Two applies into the same
    // workbook must carry DISTINCT nonces so their template calcs can't shadow each
    // other (the core turns distinct nonces into collision-free calc-name suffixes).
    const extra = makeExtra();

    await getResult({ ...BASE_PARAMS, templateParameters: { DATASOURCE: 'Sales Data' } }, extra);
    await getResult({ ...BASE_PARAMS, templateParameters: { DATASOURCE: 'Sales Data' } }, extra);

    const calls = vi.mocked(rewriteFieldReferences).mock.calls;
    expect(calls).toHaveLength(2);

    const opts1 = calls[0][4] as { namespaceCalcs?: boolean; applyNonce?: string };
    const opts2 = calls[1][4] as { namespaceCalcs?: boolean; applyNonce?: string };
    expect(opts1).toMatchObject({ namespaceCalcs: true });
    expect(opts2).toMatchObject({ namespaceCalcs: true });
    expect(opts1.applyNonce).toBeTruthy();
    expect(opts2.applyNonce).toBeTruthy();
    expect(opts1.applyNonce).not.toBe(opts2.applyNonce);
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
