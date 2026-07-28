import { Ok } from 'ts-results-es';

import type { BinderResult, BindingProposal } from '../../../desktop/binder/binder.js';
import * as binderModule from '../../../desktop/binder/binder.js';
import type { TemplateManifest } from '../../../desktop/binder/manifest-types.js';
import * as getWorkbookXmlModule from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { loadWorksheetXml } from '../../../desktop/commands/workbook/loadWorksheetXml.js';
import * as externalDiscovery from '../../../desktop/externalApi/discovery.js';
import { bundledIntelligenceProvider } from '../../../desktop/intelligence/provider.js';
import { sessionRouteState } from '../../../desktop/route/route-state.js';
import {
  buildInjectedWorkbookXml,
  classifyWorksheetReplaceTarget,
} from '../../../desktop/templates/injectTemplateCore.js';
import { readTemplate } from '../../../desktop/templates/templatePath.js';
import type { ToolExecutor } from '../../../desktop/toolExecutor/toolExecutor.js';
import * as validationRegistry from '../../../desktop/validation/registry.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getBindTemplateTool } from './bindTemplate.js';

vi.mock('../../../desktop/commands/workbook/getWorkbookXml.js');
vi.mock('../../../desktop/binder/binder.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../desktop/binder/binder.js')>();
  return { ...actual, bindTemplate: vi.fn() };
});
vi.mock('../../../desktop/externalApi/discovery.js');
vi.mock('../../../desktop/templates/injectTemplateCore.js', () => ({
  buildInjectedWorkbookXml: vi.fn(),
  classifyWorksheetReplaceTarget: vi.fn(),
}));
vi.mock('../../../desktop/templates/templatePath.js');
vi.mock('../../../desktop/validation/registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../desktop/validation/registry.js')>();
  return { ...actual, runValidation: vi.fn() };
});

const DATASOURCE = 'federated.h4csv';
const SHEET = 'Regional KPI';
const REGION_COLUMN = `[${DATASOURCE}].[none:Region:nk]`;
const AMOUNT_COLUMN = `[${DATASOURCE}].[sum:amount_usd:qk]`;
const SIGNAL = new AbortController().signal;

const FEDERATED_DATASOURCE_XML = `<datasources>
  <datasource caption='h4-kpi.csv' inline='true' name='${DATASOURCE}'>
    <connection class='federated'>
      <named-connections>
        <named-connection caption='h4-kpi.csv' name='textscan.h4csv'>
          <connection class='textscan' directory='/tmp' filename='h4-kpi.csv' />
        </named-connection>
      </named-connections>
      <metadata-records>
        <metadata-record class='column'><local-name>[Region]</local-name><parent-name>[h4-kpi.csv]</parent-name></metadata-record>
        <metadata-record class='column'><local-name>[amount_usd]</local-name><parent-name>[h4-kpi.csv]</parent-name></metadata-record>
      </metadata-records>
    </connection>
    <column caption='Region' datatype='string' name='[Region]' role='dimension' type='nominal' />
    <column caption='Amount USD' datatype='real' name='[amount_usd]' role='measure' type='quantitative' />
  </datasource>
</datasources>`;

const UNFILTERED_KPI_WORKSHEET_XML = `<worksheet name='${SHEET}' xmlns:user='http://www.tableausoftware.com/xml/user'>
  <table>
    <view>
      <datasources>
        <datasource caption='h4-kpi.csv' name='${DATASOURCE}'><connection class='textscan' /></datasource>
      </datasources>
      <datasource-dependencies datasource='${DATASOURCE}'>
        <column caption='Amount USD' datatype='real' name='[amount_usd]' role='measure' type='quantitative' />
        <column-instance column='[amount_usd]' derivation='Sum' name='[sum:amount_usd:qk]' pivot='key' type='quantitative' />
      </datasource-dependencies>
      <aggregation value='true' />
    </view>
    <panes><pane><mark class='Text' /><encodings><text column='${AMOUNT_COLUMN}' /></encodings></pane></panes>
    <rows />
    <cols />
  </table>
  <simple-id uuid='00000000-0000-0000-0000-000000000001' />
</worksheet>`;

const FILTER_XML = `<filter class='categorical' column='${REGION_COLUMN}'>
  <groupfilter function='union' user:ui-enumeration='inclusive' user:ui-marker='enumerate'>
    <groupfilter function='member' level='[none:Region:nk]' member='EMEA' user:ui-enumeration='inclusive' user:ui-marker='enumerate' />
    <groupfilter function='member' level='[none:Region:nk]' member='AMER' user:ui-enumeration='inclusive' user:ui-marker='enumerate' />
  </groupfilter>
</filter>`;

const FILTERED_KPI_WORKSHEET_XML = UNFILTERED_KPI_WORKSHEET_XML.replace(
  "        <column caption='Amount USD'",
  "        <column caption='Region' datatype='string' name='[Region]' role='dimension' type='nominal' />\n" +
    "        <column-instance column='[Region]' derivation='None' name='[none:Region:nk]' pivot='key' type='nominal' />\n" +
    "        <column caption='Amount USD'",
)
  .replace(
    "      <aggregation value='true' />",
    `      ${FILTER_XML}\n      <slices><column>${REGION_COLUMN}</column></slices>\n      <aggregation value='true' />`,
  )
  .replace(
    "<mark class='Text' />",
    `<mark class='Text' /><encodings><text column='${AMOUNT_COLUMN}' /></encodings>`,
  )
  .replace(
    `<encodings><text column='${AMOUNT_COLUMN}' /></encodings><encodings><text column='${AMOUNT_COLUMN}' /></encodings>`,
    `<encodings><text column='${AMOUNT_COLUMN}' /></encodings>`,
  );

const LIVE_WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>${FEDERATED_DATASOURCE_XML}
  <worksheets><worksheet name='${SHEET}'><table /></worksheet></worksheets>
  <windows><window class='worksheet' name='${SHEET}' /></windows>
</workbook>`;

const INJECTED_WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>${FEDERATED_DATASOURCE_XML}
  <worksheets>${UNFILTERED_KPI_WORKSHEET_XML}</worksheets>
  <windows><window class='worksheet' name='${SHEET}'><cards /></window></windows>
</workbook>`;

const BOUND_RESULT: BinderResult = {
  status: 'bound',
  used_llm: true,
  apply_hint: 'worksheet-path',
  apply_instruction: 'Apply the bound worksheet.',
  applied_bindings: [{ slot_id: 'value', field: 'Amount USD' }],
  args: {
    template_name: 'text-kpi',
    title: SHEET,
    sheet_type: 'worksheet',
    template_parameters: { DATASOURCE },
    field_mapping: { value: AMOUNT_COLUMN },
    filters: [{ field: 'Region', values: ['EMEA', 'AMER'] }],
  },
};

const PROPOSAL: BindingProposal & { confidence: number } = {
  template: 'text-kpi',
  title: SHEET,
  bindings: [{ slot_id: 'value', field: 'Amount USD' }],
  confidence: 0.99,
  filters: [{ field: 'Region', values: ['EMEA', 'AMER'] }],
};

function captureExecutor(initialXml: string): {
  executor: ToolExecutor;
  applyWorkbookDocument: ReturnType<typeof vi.fn>;
} {
  let liveXml = initialXml;
  const applyWorkbookDocument = vi.fn(async (xml: string) => {
    liveXml = xml;
    return Ok({ command_id: 'apply-h4', status: 'completed', submitted_at: '' });
  });
  const executor = {
    applyWorkbookDocument,
    executeCommand: vi.fn(async () =>
      Ok({ command_id: 'command-h4', status: 'completed', submitted_at: '' }),
    ),
    getEvents: vi.fn(async () => Ok({ events: [], latest_sequence: 7, count: 0 })),
    getWorkbookDocument: vi.fn(async () =>
      Ok({ xml: liveXml, applicationVersion: undefined, xsdPayloadVersion: undefined }),
    ),
    listWorksheets: vi.fn(async () => Ok({ worksheets: [{ id: 'sheet-h4', name: SHEET }] })),
    getWorksheetDocument: vi.fn(async () =>
      Ok({ xml: liveXml, applicationVersion: undefined, xsdPayloadVersion: undefined }),
    ),
  } as unknown as ToolExecutor;
  return { executor, applyWorkbookDocument };
}

function expectCategoricalFilter(postBody: string): void {
  expect(postBody).toMatch(
    new RegExp(
      `<filter[^>]*class=["']categorical["'][^>]*column=["']${escapeRegex(REGION_COLUMN)}["']`,
    ),
  );
  expect(postBody).toMatch(/<groupfilter[^>]*member=["']EMEA["']/);
  expect(postBody).toMatch(/<groupfilter[^>]*member=["']AMER["']/);
  expect(postBody).toMatch(/<column[^>]*name=["']\[Region\]["'][^>]*role=["']dimension["']/);
  expect(postBody).toMatch(
    /<column-instance[^>]*column=["']\[Region\]["'][^>]*name=["']\[none:Region:nk\]["']/,
  );
  expect(postBody).toContain(`<column>${REGION_COLUMN}</column>`);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionRouteState.clear();
  vi.mocked(externalDiscovery.discoverInstances).mockReturnValue([]);
  vi.mocked(classifyWorksheetReplaceTarget).mockReset();
  vi.mocked(validationRegistry.runValidation).mockReturnValue({ valid: true, issues: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('categorical filter persistence in whole-workbook POST bodies', () => {
  it('binder auto-apply emits the Region member union', async () => {
    const { executor, applyWorkbookDocument } = captureExecutor(LIVE_WORKBOOK_XML);
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockResolvedValue(Ok(LIVE_WORKBOOK_XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(BOUND_RESULT);
    vi.spyOn(bundledIntelligenceProvider, 'listTemplateManifests').mockReturnValue([
      {
        template: 'text-kpi',
        fast_path_eligible: true,
        slots: [],
      } as unknown as TemplateManifest,
    ]);
    vi.mocked(readTemplate).mockReturnValue('<worksheet />');
    vi.mocked(buildInjectedWorkbookXml).mockReturnValue({
      ok: true,
      xml: INJECTED_WORKBOOK_XML,
    });

    const tool = getBindTemplateTool(new DesktopMcpServer());
    const callback = await Provider.from(tool.callback);
    const result = await callback(
      {
        session: '1',
        ask: 'Show amount_usd for EMEA and AMER',
        proposal: PROPOSAL,
        auto_apply: true,
        minConfidence: undefined,
        target_worksheet: undefined,
        calcs: undefined,
      },
      {
        ...getMockRequestHandlerExtra(),
        getExecutor: vi.fn().mockResolvedValue(executor),
      },
    );

    expect(result.isError).toBe(false);
    expect(applyWorkbookDocument).toHaveBeenCalledOnce();
    expectCategoricalFilter(applyWorkbookDocument.mock.calls[0][0] as string);
  });

  it('manual loadWorksheetXml emits the authored Region member union', async () => {
    const { executor, applyWorkbookDocument } = captureExecutor(LIVE_WORKBOOK_XML);
    vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockResolvedValue(Ok(LIVE_WORKBOOK_XML));

    const result = await loadWorksheetXml({
      worksheetName: SHEET,
      xml: FILTERED_KPI_WORKSHEET_XML,
      focus: { navigate: 'none', reason: 'intermediate-leg' },
      executor,
      signal: SIGNAL,
    });

    expect(result.isOk()).toBe(true);
    expect(applyWorkbookDocument).toHaveBeenCalledOnce();
    expectCategoricalFilter(applyWorkbookDocument.mock.calls[0][0] as string);
  });
});
