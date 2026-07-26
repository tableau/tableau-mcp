import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import type { BinderResult, BindingProposal } from '../../../desktop/binder/binder.js';
import * as binderModule from '../../../desktop/binder/binder.js';
import { loadManifests } from '../../../desktop/binder/manifest.js';
import type { TemplateManifest } from '../../../desktop/binder/manifest-types.js';
import * as routeSpecModule from '../../../desktop/binder/route-spec.js';
import { normalizeAskForMatch } from '../../../desktop/binder/route-spec.js';
import type { SchemaField } from '../../../desktop/binder/schema-summary.js';
import * as getWorkbookXmlModule from '../../../desktop/commands/workbook/getWorkbookXml.js';
import * as externalDiscovery from '../../../desktop/externalApi/discovery.js';
import { bundledIntelligenceProvider } from '../../../desktop/intelligence/provider.js';
import * as xmlToJsonModule from '../../../desktop/libraries/workbook-serialization-converter/index.js';
import { normalizeArray, parseXML } from '../../../desktop/metadata/parser.js';
import type { ParsedWindow } from '../../../desktop/metadata/types.js';
import { serializeRouteReceipt, sessionRouteState } from '../../../desktop/route/route-state.js';
import {
  buildInjectedWorkbookXml,
  classifyWorksheetReplaceTarget,
} from '../../../desktop/templates/injectTemplateCore.js';
import { readTemplate } from '../../../desktop/templates/templatePath.js';
import * as validationRegistry from '../../../desktop/validation/registry.js';
import {
  DesktopCommandExecutionError,
  NoDesktopInstancesFoundError,
} from '../../../errors/mcpToolError.js';
import * as loggerModule from '../../../logging/logger.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { appliedSheetSignature } from './appliedSheetSignature.js';
import { getBindTemplateTool } from './bindTemplate.js';
import { proposalSignature } from './proposalSignature.js';

// Auto-mock the live-read command. Partial-mock the binder core so the pure
// DERIVATION_* exports used to build the zod schema stay intact while only
// bindTemplate is stubbed. The bundled provider is exercised for REAL (data ships
// in-repo, hermetic) — matching propose-template / validate-proposal; the "provider
// seam" test spies on listTemplateManifests to prove the tool sources manifests
// through the seam rather than a raw loader.
vi.mock('../../../desktop/commands/workbook/getWorkbookXml.js');
vi.mock('../../../desktop/binder/binder.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../desktop/binder/binder.js')>();
  return { ...actual, bindTemplate: vi.fn() };
});

// ── Auto-apply / session-default seams (W60) ──────────────────────────────────
// The auto-apply leg runs the REAL validated apply path (loadWorkbookXml → real
// runValidation → executor dispatch) so a bind can never silently skip preflight;
// only the boundaries are mocked. External API discovery is mocked for session-default
// resolution. The shared inject core is stubbed (its transform is proven by
// injectTemplate's own suite) so these tests own only the bind-template wiring.
vi.mock('../../../desktop/externalApi/discovery.js');
vi.mock('../../../desktop/libraries/workbook-serialization-converter/index.js');
vi.mock('../../../desktop/templates/injectTemplateCore.js', () => ({
  buildInjectedWorkbookXml: vi.fn(),
  classifyWorksheetReplaceTarget: vi.fn(),
}));
vi.mock('../../../desktop/templates/templatePath.js');
vi.mock('../../../desktop/validation/registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../desktop/validation/registry.js')>();
  return { ...actual, runValidation: vi.fn() };
});
// Partial fs mock: the bound template is read via the mocked SEA-aware
// `readTemplate` seam (templatePath.js above), so fs reads stay live for the real
// manifest/content loads (manifest.ts / provider.ts via the assets seam); only
// writes are stubbed so no test touches disk.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: (actual as unknown as { default?: typeof actual }).default ?? actual,
    writeFileSync: vi.fn(),
  };
});

const XML = '<?xml version="1.0"?><workbook></workbook>';
const ENCODING_GUIDANCE_XML = `<?xml version='1.0'?>
<workbook>
  <datasources>
    <datasource name='World Cup'>
      <column name='[country_code]' caption='Country Code' role='dimension' type='nominal' datatype='string' />
      <column name='[goals]' caption='Goals' role='measure' type='quantitative' datatype='integer' />
      <column name='[goals_for]' caption='Goals For' role='measure' type='quantitative' datatype='integer' />
    </datasource>
  </datasources>
</workbook>`;
const RANKING_CONTEXT_WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='Superstore'>
      <column caption='Customer Name' name='[Customer Name]' role='dimension' type='nominal' datatype='string' />
      <column caption='Sales' name='[Sales]' role='measure' type='quantitative' datatype='real' />
      <column caption='Profit' name='[Profit]' role='measure' type='quantitative' datatype='real' />
    </datasource>
  </datasources>
</workbook>`;
const CURRENCY_WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='Superstore'>
      <column caption='Region' name='[Region]' role='dimension' type='nominal' datatype='string' />
      <column caption='Currency Code' name='[currency_code]' role='dimension' type='nominal' datatype='string' />
      <column caption='Sales' name='[Sales]' role='measure' type='quantitative' datatype='real' />
    </datasource>
  </datasources>
</workbook>`;

/**
 * The block a client actually receives: the JSON body plus the nextAction envelope. A
 * client that prefers structuredContent drops content[0] outright, so asserting the body is
 * folded in is asserting the agent still learns status, guidance and the sheet_name it just
 * created — not just "what to do next".
 */
function expectStructuredBlock(result: CallToolResult, nextAction: unknown): void {
  invariant(result.content[0].type === 'text');
  expect(result.structuredContent).toEqual({
    ...JSON.parse(result.content[0].text),
    nextAction,
  });
}

/** The terminal marker a complete auto-apply mints, receipt and all. */
const COMPLETE_BIND_NEXT_ACTION = {
  label: 'Chart complete — no further calls needed',
  kind: 'done',
  receipt: {
    did: expect.arrayContaining([expect.stringContaining('Desktop accepted the document')]),
    didNot: [],
    // This fixture has no binder encoding report, and structural readback never sees pixels.
    // Both gaps must remain explicit instead of becoming successful claims by omission.
    unverified: expect.arrayContaining([
      expect.stringContaining('encoding analysis did not run'),
      expect.stringContaining('renders any marks'),
    ]),
  },
};

const INJECTED_RANKING_WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <worksheets>
    <worksheet name='Sales by Region' xmlns:user='http://www.tableausoftware.com/xml/user'>
      <table>
        <view>
          <datasources>
            <datasource caption='Superstore' name='Superstore' />
          </datasources>
          <datasource-dependencies datasource='Superstore'>
            <column caption='Region' datatype='string' name='[Region]' role='dimension' type='nominal' />
            <column caption='Sales' datatype='real' name='[Sales]' role='measure' type='quantitative' />
            <column-instance column='[Region]' derivation='None' name='[none:Region:nk]' pivot='key' type='nominal' />
            <column-instance column='[Sales]' derivation='Sum' name='[sum:Sales:qk]' pivot='key' type='quantitative' />
          </datasource-dependencies>
          <aggregation value='true' />
        </view>
        <style />
        <panes>
          <pane>
            <view><breakdown value='auto' /></view>
            <mark class='Bar' />
          </pane>
        </panes>
        <rows>[Superstore].[none:Region:nk]</rows>
        <cols>[Superstore].[sum:Sales:qk]</cols>
      </table>
      <simple-id uuid='00000000-0000-0000-0000-000000000001' />
    </worksheet>
  </worksheets>
</workbook>`;
const INJECTED_RANKING_WITH_CURRENCY_COLOR_XML = INJECTED_RANKING_WORKBOOK_XML.replace(
  "            <column caption='Sales' datatype='real' name='[Sales]' role='measure' type='quantitative' />",
  [
    "            <column caption='Sales' datatype='real' name='[Sales]' role='measure' type='quantitative' />",
    "            <column caption='Currency Code' datatype='string' name='[currency_code]' role='dimension' type='nominal' />",
    "            <column-instance column='[currency_code]' derivation='None' name='[none:currency_code:nk]' pivot='key' type='nominal' />",
  ].join('\n'),
).replace(
  "            <mark class='Bar' />",
  "            <mark class='Bar' />\n            <encodings><color column='[Superstore].[none:currency_code:nk]' /></encodings>",
);
const INJECTED_RANKING_WITH_AVERAGE_XML = INJECTED_RANKING_WORKBOOK_XML.replaceAll(
  'sum:Sales',
  'avg:Sales',
).replace("derivation='Sum'", "derivation='Average'");
const INJECTED_WORKBOOK_WITH_NEW_SHEET_WINDOW = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <worksheets>
    <worksheet name='Old Sheet'><table /></worksheet>
    <worksheet name='Sales by Region'><table /></worksheet>
  </worksheets>
  <windows>
    <window class='worksheet' name='Old Sheet' active='true' maximized='true' />
    <window class='worksheet' name='Sales by Region' />
  </windows>
</workbook>`;
const P_AND_L_WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='PL'>
      <column name='[line_item]' role='dimension' type='nominal' datatype='string' />
      <column name='[amount]' role='measure' type='quantitative' datatype='real' />
      <column name='[category]' role='dimension' type='nominal' datatype='string' />
      <column name='[display_order]' role='measure' type='quantitative' datatype='integer' />
    </datasource>
  </datasources>
</workbook>`;
const P_AND_L_WORKBOOK_XML_WITHOUT_DISPLAY_ORDER = P_AND_L_WORKBOOK_XML.replace(
  /\n {6}<column name='\[display_order\]'[^>]* \/>/,
  '',
);
const P_AND_L_WORKBOOK_XML_WITHOUT_CATEGORY = P_AND_L_WORKBOOK_XML.replace(
  /\n {6}<column name='\[category\]'[^>]* \/>/,
  '',
);
const INJECTED_WATERFALL_WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <worksheets>
    <worksheet name='P&amp;L Waterfall'>
      <table>
        <view>
          <datasources>
            <datasource name='PL' />
          </datasources>
          <datasource-dependencies datasource='PL'>
            <column caption='-SUM([amount])' datatype='real' name='[Calculation_767019348535836686]' role='measure' type='quantitative'>
              <calculation class='tableau' formula='-SUM([amount])' />
            </column>
            <column datatype='real' name='[amount]' role='measure' type='quantitative' />
            <column datatype='string' name='[line_item]' role='dimension' type='nominal' />
            <column-instance column='[amount]' derivation='Sum' name='[cum:sum:amount:qk]' pivot='key' type='quantitative'>
              <table-calc aggregation='Sum' ordering-type='Rows' type='CumTotal' />
            </column-instance>
            <column-instance column='[line_item]' derivation='None' name='[none:line_item:nk]' pivot='key' type='nominal' />
            <column-instance column='[amount]' derivation='Sum' name='[sum:amount:qk]' pivot='key' type='quantitative' />
            <column-instance column='[Calculation_767019348535836686]' derivation='User' name='[usr:Calculation_767019348535836686:qk]' pivot='key' type='quantitative' />
          </datasource-dependencies>
          <computed-sort column='[PL].[none:line_item:nk]' direction='DESC' using='[PL].[sum:amount:qk]' />
          <aggregation value='true' />
        </view>
        <panes><pane><mark class='GanttBar' /></pane></panes>
        <rows>[PL].[cum:sum:amount:qk]</rows>
        <cols>[PL].[none:line_item:nk]</cols>
      </table>
    </worksheet>
  </worksheets>
</workbook>`;
const REAL_INJECTED_WATERFALL_SORT_SHAPE_XML = INJECTED_WATERFALL_WORKBOOK_XML.replace(
  "<computed-sort column='[PL].[none:line_item:nk]' direction='DESC' using='[PL].[sum:amount:qk]' />",
  '<computed-sort column="[PL].[none:line_item:nk]" direction="DESC" using="[PL].[sum:amount:qk]"></computed-sort>',
);
const CALC_BASE_XML = [
  "<?xml version='1.0' encoding='utf-8'?>",
  "<workbook version='18.1'>",
  '<datasources>',
  "<datasource name='Superstore'>",
  "<column caption='Sales' datatype='real' name='[Sales]' role='measure' type='quantitative' />",
  '</datasource>',
  '</datasources>',
  "<worksheets><worksheet name='Sheet 1' /></worksheets>",
  '</workbook>',
].join('');
const CALC_COLUMN_XML =
  "<column caption='Margin' datatype='real' name='[Calculation_1700000000000]' role='measure' type='quantitative'><calculation class='tableau' formula='[Sales] * 0.2' /></column>";
const CALC_READBACK_XML = CALC_BASE_XML.replace('</datasource>', `${CALC_COLUMN_XML}</datasource>`);

const boundResult: BinderResult = {
  status: 'bound',
  used_llm: false,
  apply_hint: 'worksheet-path',
  apply_instruction: 'Create a sheet, substitute the fragment, then apply-worksheet.',
  args: {
    template_name: 'bar-basic',
    title: 'Sales by Region',
    sheet_type: 'worksheet',
    template_parameters: { DATASOURCE: 'Superstore' },
    field_mapping: { cat: '[Region]', val: '[Sales]' },
  },
};

const proposeResult: BinderResult = {
  status: 'propose',
  decline_reason: {
    code: 'no_llm_classifier_declined',
    detail: 'classifyNoLlm returned no deterministic template; routed to proposal candidates',
  },
  llm_input: {
    ask: 'bar chart of Sales by Region',
    candidate_templates: [],
    fields: [],
  } as unknown as Extract<BinderResult, { status: 'propose' }>['llm_input'],
  output_schema: { type: 'object' },
};
const recommendedProposeResult: BinderResult = {
  ...proposeResult,
  llm_input: {
    ...proposeResult.llm_input,
    recommended: {
      measure: 'Sales',
      top_n: 10,
      reason: 'revenue-like measure; top-N defaults to 10',
      context_measures: ['Profit'],
      binding: {
        template: 'bar-basic',
        bindings: [
          { slot_id: 'cat', field: 'Region' },
          { slot_id: 'val', field: 'Sales' },
        ],
      },
    } as any,
  },
};
const contestedRevenueProposeResult: BinderResult = {
  ...proposeResult,
  llm_input: {
    ...proposeResult.llm_input,
    ask: 'Show me our top customers.',
    fields: [
      { name: 'Customer Name', role: 'dimension', type: 'nominal', datatype: 'string' },
      { name: 'Sales', role: 'measure', type: 'quantitative', datatype: 'real' },
      { name: 'Revenue', role: 'measure', type: 'quantitative', datatype: 'real' },
    ],
  },
};
const ambiguousGoalsProposeResult: BinderResult = {
  status: 'propose',
  decline_reason: {
    code: 'no_llm_classifier_declined',
    detail: 'classifyNoLlm returned no deterministic template; routed to proposal candidates',
  },
  llm_input: {
    ask: 'symbol map of countries by goals scored',
    candidate_templates: [
      {
        template: 'spatial-symbol-map',
        description: 'Symbol map',
        intent_keywords: ['symbol-map'],
        slots: [
          { slot_id: 'country', role: ['dimension'], kind: 'geo', required: true },
          { slot_id: 'sales', role: ['measure'], kind: 'quantitative', required: true },
        ],
      },
    ],
    fields: [
      { name: 'Country Code', role: 'dimension', type: 'nominal', datatype: 'string' },
      {
        name: 'Goals',
        role: 'measure',
        type: 'quantitative',
        datatype: 'integer',
        table: '[players.csv]',
        label: 'Goals (from players.csv)',
      },
      {
        name: 'Goals For',
        role: 'measure',
        type: 'quantitative',
        datatype: 'integer',
        table: '[standings.csv]',
        label: 'Goals For (from standings.csv)',
      },
      {
        name: 'Goals Against',
        role: 'measure',
        type: 'quantitative',
        datatype: 'integer',
        table: '[standings.csv]',
        label: 'Goals Against (from standings.csv)',
      },
      { name: 'Goal Difference', role: 'measure', type: 'quantitative', datatype: 'integer' },
    ],
  } as unknown as Extract<BinderResult, { status: 'propose' }>['llm_input'],
  output_schema: { type: 'object' },
};
const waterfallProposeResult: BinderResult = {
  status: 'propose',
  decline_reason: {
    code: 'no_llm_classifier_declined',
    detail: 'classifyNoLlm returned no deterministic template; routed to proposal candidates',
  },
  llm_input: {
    ask: 'P&L waterfall',
    candidate_templates: [
      {
        template: 'part-to-whole-waterfall',
        description: 'Waterfall chart',
        intent_keywords: ['waterfall'],
        slots: [
          { slot_id: 'profit', role: ['measure'], kind: 'quantitative', required: true },
          {
            slot_id: 'sub_category',
            role: ['dimension'],
            kind: 'categorical',
            required: true,
          },
          {
            slot_id: 'anchor_category',
            role: ['dimension'],
            kind: 'categorical',
            required: false,
          },
        ],
      },
    ],
    fields: [
      { name: 'line_item', role: 'dimension', type: 'nominal', datatype: 'string' },
      { name: 'category', role: 'dimension', type: 'nominal', datatype: 'string' },
      { name: 'amount', role: 'measure', type: 'quantitative', datatype: 'real' },
      { name: 'budget', role: 'measure', type: 'quantitative', datatype: 'real' },
    ],
  } as unknown as Extract<BinderResult, { status: 'propose' }>['llm_input'],
  output_schema: { type: 'object' },
};

const escalateResult: BinderResult = {
  status: 'escalate',
  reason: 'field-not-found',
  blockers: [{ code: 'field-not-found', slot_id: 'val', detail: 'No field named "Revenue".' }],
};

const tier2EscalateResult: BinderResult = {
  status: 'escalate',
  reason: 'not-fast-path',
  blockers: [
    {
      code: 'not-fast-path',
      detail: "template 'ww-ou-diff' is not fast-path eligible (readiness=experimental)",
    },
  ],
};

const sampleProposal: BindingProposal & { confidence: number } = {
  template: 'bar-basic',
  title: 'Sales by Region',
  bindings: [
    { slot_id: 'cat', field: 'Region' },
    { slot_id: 'val', field: 'Sales' },
  ],
  confidence: 0.9,
};
const sampleProposalTitleOnlyChange: BindingProposal & { confidence: number } = {
  ...sampleProposal,
  title: 'Sales by Region v2',
  confidence: 0.99,
};
const changedProposal: BindingProposal & { confidence: number } = {
  ...sampleProposal,
  bindings: [
    { slot_id: 'cat', field: 'Region' },
    { slot_id: 'val', field: 'Profit' },
  ],
};
const changedProposalAgain: BindingProposal & { confidence: number } = {
  ...changedProposal,
  sort: { by: 'Profit', direction: 'desc' },
};

// A Call-2 proposal that validated into a bound result is marked used_llm:true.
// The auto-apply gate should preserve that field on non-applied results, but it no
// longer blocks server-side auto-apply by itself.
const boundViaProposalResult: BinderResult = { ...boundResult, used_llm: true };
const boundWithSortResult: BinderResult = {
  ...boundViaProposalResult,
  args: {
    ...boundViaProposalResult.args,
    sort: { by: 'Sales', direction: 'desc' },
  },
};
const boundWithTopNResult: BinderResult = {
  ...boundViaProposalResult,
  args: {
    ...boundViaProposalResult.args,
    top_n: 10,
  },
};
const boundWithSortAndTopNResult: BinderResult = {
  ...boundViaProposalResult,
  args: {
    ...boundViaProposalResult.args,
    sort: { by: 'Sales', direction: 'desc' },
    top_n: 10,
  },
};
// m7 declarative-filter (order-of-operations) fixtures. READ workbook carries product/region/sales
// so the filter splice can resolve "Region" → its CI; the injected sheet ranks PRODUCT (top-10),
// with a worksheet window so the shown filter card has a home.
const M7_WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='M7'>
      <column caption='Product' name='[product]' role='dimension' type='nominal' datatype='string' />
      <column caption='Region' name='[region]' role='dimension' type='nominal' datatype='string' />
      <column caption='Sales' name='[sales]' role='measure' type='quantitative' datatype='integer' />
    </datasource>
  </datasources>
</workbook>`;
const INJECTED_M7_RANKING_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <worksheets>
    <worksheet name='Top 10 Products' xmlns:user='http://www.tableausoftware.com/xml/user'>
      <table>
        <view>
          <datasources>
            <datasource caption='M7' name='M7' />
          </datasources>
          <datasource-dependencies datasource='M7'>
            <column caption='Product' datatype='string' name='[product]' role='dimension' type='nominal' />
            <column caption='Sales' datatype='integer' name='[sales]' role='measure' type='quantitative' />
            <column-instance column='[product]' derivation='None' name='[none:product:nk]' pivot='key' type='nominal' />
            <column-instance column='[sales]' derivation='Sum' name='[sum:sales:qk]' pivot='key' type='quantitative' />
          </datasource-dependencies>
          <aggregation value='true' />
        </view>
        <style />
        <panes>
          <pane>
            <view><breakdown value='auto' /></view>
            <mark class='Bar' />
          </pane>
        </panes>
        <rows>[M7].[none:product:nk]</rows>
        <cols>[M7].[sum:sales:qk]</cols>
      </table>
      <simple-id uuid='00000000-0000-0000-0000-000000000001' />
    </worksheet>
  </worksheets>
  <windows>
    <window class='worksheet' name='Top 10 Products'>
      <cards />
      <simple-id uuid='00000000-0000-0000-0000-000000000002' />
    </window>
  </windows>
</workbook>`;
const boundM7TopNContextFilterResult: BinderResult = {
  ...boundViaProposalResult,
  args: {
    template_name: 'ranking-ordered-bar',
    title: 'Top 10 Products',
    sheet_type: 'worksheet',
    template_parameters: { DATASOURCE: 'M7' },
    field_mapping: {
      Region: '[M7].[none:product:nk]',
      Sales: '[M7].[sum:sales:qk]',
    },
    top_n: 10,
    filters: [{ field: 'Region', context: true }],
  },
};
const boundWaterfallResult: BinderResult = {
  ...boundViaProposalResult,
  args: {
    template_name: 'part-to-whole-waterfall',
    title: 'P&amp;L Waterfall',
    sheet_type: 'worksheet',
    template_parameters: { DATASOURCE: 'PL' },
    field_mapping: {
      Profit: '[PL].[sum:amount:qk]',
      'Sub-Category': '[PL].[none:line_item:nk]',
    },
  },
};
const boundWaterfallWithSortResult: BinderResult = {
  ...boundWaterfallResult,
  args: {
    ...boundWaterfallResult.args,
    sort: { by: 'display_order', direction: 'asc' },
  },
};
const boundWaterfallWithAnchorResult: BinderResult = {
  ...boundWaterfallResult,
  args: {
    ...boundWaterfallResult.args,
    field_mapping: {
      ...boundWaterfallResult.args.field_mapping,
      'Anchor Category': '[PL].[none:category:nk]',
    },
  },
};
const badSortFieldEscalateResult: BinderResult = {
  status: 'escalate',
  reason: 'field-not-found',
  blockers: [
    {
      code: 'field-not-found',
      detail: 'no sort.by field named "Definitely Not A Field" in datasource(s)',
    },
  ],
  proposal: {
    ...sampleProposal,
    sort: { by: 'Definitely Not A Field', direction: 'desc' },
  },
};

beforeEach(() => {
  sessionRouteState.clear();
  vi.mocked(getWorkbookXmlModule.getWorkbookXml).mockReset();
  vi.mocked(binderModule.bindTemplate).mockReset();
  vi.mocked(classifyWorksheetReplaceTarget).mockReset();
});

describe('bindTemplateTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(externalDiscovery.discoverInstances).mockReturnValue([]);
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getBindTemplateTool(new DesktopMcpServer());
    expect(tool.name).toBe('bind-template');
    expect(tool.description).toBe(
      'Bind. applied_default=>state as default+offer change. Quote summary_rows; fetch now if absent/cut/error.',
    );
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      ask: expect.any(Object),
      proposal: expect.any(Object),
      minConfidence: expect.any(Object),
      calcs: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({
      // NOT read-only / NOT idempotent: auto_apply + calcs[] mutate the live workbook.
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it('returns status "bound" with args and apply_instruction as guidance (Call 1)', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(boundResult);

    const result = await getToolResult({ session: '1', ask: 'bar chart of Sales by Region' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.status).toBe('bound');
    expect(body.args.template_name).toBe('bar-basic');
    expect(body.guidance).toBe(boundResult.status === 'bound' ? boundResult.apply_instruction : '');
  });

  it('returns the standard MCP content-block envelope, not a bare JSON string', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(boundResult);

    const result = await getToolResult({ session: '1', ask: 'bar chart of Sales by Region' });

    expect(result).toMatchObject({
      isError: false,
      content: [{ type: 'text', text: expect.any(String) }],
    });
    expect(result.content).toHaveLength(1);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toEqual({
      ...boundResult,
      guidance: boundResult.status === 'bound' ? boundResult.apply_instruction : '',
    });
  });

  it('returns status "propose" (not an error) with next-step guidance (Call 1 miss)', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(proposeResult);

    const result = await getToolResult({ session: '1', ask: 'something weird' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.status).toBe('propose');
    expect(body.decline_reason).toEqual(proposeResult.decline_reason);
    expect(body.output_schema).toEqual({ type: 'object' });
    expect(body.guidance).toContain('Call 2');
    expect(body.guidance).toContain('auto_apply:true');
    expect(body.guidance).toContain('Do not call other authoring tools between calls');
    expect(body.guidance).toContain('ask-user');
    expect(body.guidance).not.toContain('add-field');
    expect(body.guidance).not.toContain('build-and-apply-worksheet');
    expectStructuredBlock(result, {
      label: 'Supply proposal from call_2_contract to bind-template',
      kind: 'prefill',
    });
  });

  it('auto_apply=false returns the recommended ranking proposal without applying it', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(recommendedProposeResult);

    const result = await getToolResult({
      session: '1',
      ask: 'Show me our top customers.',
      auto_apply: false,
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.status).toBe('propose');
    expect(body.applied).toBeUndefined();
    expect(body.llm_input.recommended).toEqual(recommendedProposeResult.llm_input.recommended);
    expect(body.call_2_contract.recommended).toEqual(
      recommendedProposeResult.llm_input.recommended,
    );
    expect(body.guidance).toContain('Call 2');
    expect(body.guidance).toContain('Sales');
    expect(body.guidance).toContain('top_n:10');
    expect(body.guidance).toContain('STATE this choice in your reply');
    expect(body.guidance).not.toContain('ask-user');
    expect(binderModule.bindTemplate).toHaveBeenCalledTimes(1);
  });

  it('requires a call_2_contract proposal in the Call 1 nextAction label', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(proposeResult);

    const result = await getToolResult({ session: '1', ask: 'something weird' });

    expect(result.structuredContent?.nextAction).toEqual({
      label: 'Supply proposal from call_2_contract to bind-template',
      kind: 'prefill',
    });
    expect(result.structuredContent).not.toEqual({
      nextAction: {
        label: 'Resubmit bind-template with proposal and auto_apply:true',
        kind: 'prefill',
      },
    });
  });

  it('returns an exact Call-2 contract without choosing among compatible fields', async () => {
    const workbookWithTarget = P_AND_L_WORKBOOK_XML.replace(
      '</workbook>',
      "<worksheets><worksheet name='P&amp;L'/></worksheets></workbook>",
    );
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(workbookWithTarget));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(waterfallProposeResult);

    const result = await getToolResult({
      session: '1',
      ask: 'P&L waterfall',
      target_worksheet: 'P&L',
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.call_2_contract).toEqual({
      tool: 'bind-template',
      arguments: {
        session: '1',
        ask: 'P&L waterfall',
        target_worksheet: 'P&L',
        auto_apply: true,
      },
      proposal_choices: [
        {
          template: 'part-to-whole-waterfall',
          slots: [
            {
              slot_id: 'profit',
              required: true,
              compatible_field_names: ['amount', 'budget'],
            },
            {
              slot_id: 'sub_category',
              required: true,
              compatible_field_names: ['line_item', 'category'],
            },
            {
              slot_id: 'anchor_category',
              required: false,
              compatible_field_names: ['line_item', 'category'],
            },
          ],
        },
      ],
      proposal_requirements: {
        title: 'Choose a worksheet title.',
        confidence: 'Set a confidence from 0 to 1.',
        field_selection:
          'For each binding, choose one exact compatible_field_names value; do not rename or infer a field.',
      },
    });
    expect(body.call_2_contract.proposal_choices[0].slots[0].compatible_field_names).toHaveLength(
      2,
    );
    expect(body.call_2_contract.proposal_choices[0].slots[0]).not.toHaveProperty('field');
  });

  it('keeps the ask-named dimension in a synonym-heavy Call-2 categorical slot', async () => {
    const schemaField = (
      name: string,
      role: 'dimension' | 'measure',
      type: 'nominal' | 'quantitative',
      datatype: 'string' | 'real',
    ): SchemaField => ({
      name,
      columnName: `[${name}]`,
      role,
      type,
      datatype,
      datasource: 'DS',
      isAggregated: false,
      column_ref: `[DS].[${name}]`,
    });
    const collisionWords = [
      'Booked',
      'Billed',
      'Contracted',
      'Deferred',
      'Domestic',
      'Enterprise',
      'Forecast',
      'Gross',
      'International',
      'Invoiced',
      'Net',
      'Online',
      'Partner',
      'Pipeline',
      'Projected',
      'Recurring',
      'Renewal',
      'Retail',
      'Services',
      'Subscription',
      'Total',
      'Wholesale',
    ];
    const fields = [
      ...collisionWords.map((word, index) =>
        schemaField(
          `${word} ${index % 2 === 0 ? 'Amount' : 'Sales'}`,
          'measure',
          'quantitative',
          'real',
        ),
      ),
      ...['Customer Segment', 'Customer Name', 'Product Category', 'Market', 'Region'].map((name) =>
        schemaField(name, 'dimension', 'nominal', 'string'),
      ),
    ];
    const manifest = loadManifests().get('ranking-ordered-bar');
    invariant(manifest);
    const llmInput = binderModule.buildLlmInput(
      'bar chart of revenue by Customer Segment',
      new Map([[manifest.template, manifest]]),
      { datasource: 'DS', fields },
    );
    const synonymHeavyPropose: BinderResult = {
      ...proposeResult,
      llm_input: llmInput,
    };
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(synonymHeavyPropose);

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of revenue by Customer Segment',
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    const categoricalSlotId = manifest.slots.find((slot) => slot.kind === 'categorical')?.slot_id;
    const categoricalSlot = body.call_2_contract.proposal_choices[0].slots.find(
      (slot: { slot_id: string }) => slot.slot_id === categoricalSlotId,
    );
    expect(categoricalSlot.compatible_field_names).toContain('Customer Segment');
    expect(categoricalSlot.compatible_field_names.length).toBeGreaterThan(0);
  });

  it.each([
    {
      label: 'fabricated template alias',
      proposal: {
        template: 'waterfall',
        title: 'P&L waterfall',
        bindings: [],
        confidence: 0.9,
      },
      escalation: {
        status: 'escalate',
        reason: 'template-not-found',
        blockers: [
          {
            code: 'template-not-found',
            detail: "template 'waterfall' was not found",
          },
        ],
      } satisfies BinderResult,
    },
    {
      label: 'fabricated slot names',
      proposal: {
        template: 'part-to-whole-waterfall',
        title: 'P&L waterfall',
        bindings: [
          { slot_id: 'steps', field: 'line_item' },
          { slot_id: 'measure', field: 'amount' },
          { slot_id: 'color', field: 'category' },
        ],
        confidence: 0.9,
      },
      escalation: {
        status: 'escalate',
        reason: 'kind-mismatch',
        blockers: [
          {
            code: 'kind-mismatch',
            slot_id: 'steps',
            detail: "binding names unknown slot_id 'steps'",
          },
        ],
      } satisfies BinderResult,
    },
  ])(
    'names the exact returned contract and cleanly escalates a Call-2 $label',
    async ({ proposal, escalation }) => {
      vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(P_AND_L_WORKBOOK_XML));
      vi.mocked(binderModule.bindTemplate)
        .mockResolvedValueOnce(waterfallProposeResult)
        .mockResolvedValueOnce(escalation);

      const call1 = await getToolResult({ session: '1', ask: 'P&L waterfall' });
      invariant(call1.content[0].type === 'text');
      const call1Body = JSON.parse(call1.content[0].text);
      expect(call1Body.call_2_contract.proposal_choices[0]).toMatchObject({
        template: 'part-to-whole-waterfall',
        slots: [{ slot_id: 'profit' }, { slot_id: 'sub_category' }, { slot_id: 'anchor_category' }],
      });

      const call2 = await getToolResult({
        session: '1',
        ask: 'P&L waterfall',
        proposal,
      });
      expect(call2.isError).toBe(false);
      invariant(call2.content[0].type === 'text');
      const call2Body = JSON.parse(call2.content[0].text);
      expect(call2Body.status).toBe('escalate');
      expect(call2Body.reason).toBe(escalation.reason);
      expect(call2Body.guidance).toContain(`Escalated (${escalation.reason})`);
    },
  );

  it('returns status "escalate" as a normal outcome (isError false) with routed guidance (Call 2)', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(escalateResult);

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Revenue by Region',
      proposal: sampleProposal,
    });

    // Escalate is a business outcome, NOT a tool error (the source set isError=true;
    // this repo reserves isError for the McpToolError funnel).
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(body.guidance).toBe(
      'Escalated (field-not-found). No worksheet was produced. Blockers: ' +
        '[field-not-found] slot \'val\' No field named "Revenue".. Next: Resolve the field(s) ' +
        'with the resolve-field tool, then call bind-template again with a corrected proposal; ' +
        'otherwise ask the user with ask-user (present the candidates).' +
        ' The candidate templates and the fields that fit each of their slots are in ' +
        'call_2_contract.proposal_choices below — bind from those; do not go hunting with ' +
        'search-commands or the knowledge tools.',
    );
    // A recoverable escalation now hands over the same shortlist the propose branch does.
    expect(body.call_2_contract).toBeDefined();
    expectStructuredBlock(result, {
      label: 'Resolve the fields first; otherwise ask the user',
      kind: 'prefill',
    });
    expect(body.status).toBe('escalate');
    expect(body.reason).toBe('field-not-found');
    expect(body.guidance).toContain('field-not-found');
    expect(body.guidance).toContain('resolve-field');
  });

  it('frames non-fast-path escalation as normal, profile-visible direct authoring', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(tier2EscalateResult);

    const result = await getToolResult({
      session: '1',
      ask: 'unsupported chart',
      proposal: sampleProposal,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.status).toBe('escalate');
    expect(body.guidance).toContain('No fast-path template fits this ask/data');
    expect(body.guidance).toContain('build-and-apply-worksheet');
    expect(body.guidance).toContain('add-field then');
    expect(body.guidance).toContain('This is a normal path, not a failure');
    expect(body.guidance).toContain('If the inject-template/apply-workbook tools are available');
    expect(body.guidance).not.toContain('manual chain');
  });

  it('passes proposal and minConfidence through to the binder (Call 2)', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(boundResult);

    await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      proposal: sampleProposal,
      minConfidence: 0.8,
    });

    expect(binderModule.bindTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        ask: 'bar chart of Sales by Region',
        workbookXml: XML,
        proposal: sampleProposal,
        minConfidence: 0.8,
      }),
    );
  });

  it('funnels a workbook-read failure through the McpToolError path (isError true)', async () => {
    const error = { type: 'unknown' as const, error: new Error('Network error') };
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Err(error));

    const result = await getToolResult({ session: '1', ask: 'bar chart of Sales by Region' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error).message);
    expect(binderModule.bindTemplate).not.toHaveBeenCalled();
  });

  it('passes the abort signal to the workbook read', async () => {
    const spy = vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(boundResult);
    const customSignal = new AbortController().signal;

    await getToolResult({ session: '1', ask: 'bar chart of Sales by Region', customSignal });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ signal: customSignal }));
  });

  it('rejects a proposal without confidence at the schema layer (floor bypass guard)', async () => {
    // The binder library skips its low-confidence floor when confidence is undefined,
    // so the TOOL schema must require it (matching PROPOSAL_OUTPUT_SCHEMA) or a
    // proposal could bypass the escalation entirely.
    const tool = getBindTemplateTool(new DesktopMcpServer());
    const schema = z.object(await Provider.from(tool.paramsSchema));
    const { confidence: _omitted, ...noConfidence } = sampleProposal;
    expect(
      schema.safeParse({ session: '1', ask: 'bar chart', proposal: noConfidence }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ session: '1', ask: 'bar chart', proposal: sampleProposal }).success,
    ).toBe(true);
  });

  it('rejects a proposal whose title exceeds 80 chars at the schema layer (library uses it verbatim)', async () => {
    // validateAndBuild copies proposal.title straight into InjectTemplateArgs on the
    // Call-2 path (no truncation), so the tool schema must enforce the library's
    // declared PROPOSAL_OUTPUT_SCHEMA.title.maxLength = 80.
    const tool = getBindTemplateTool(new DesktopMcpServer());
    const schema = z.object(await Provider.from(tool.paramsSchema));
    const longTitle = { ...sampleProposal, title: 'x'.repeat(81) };
    expect(schema.safeParse({ session: '1', ask: 'bar chart', proposal: longTitle }).success).toBe(
      false,
    );
    const maxTitle = { ...sampleProposal, title: 'x'.repeat(80) };
    expect(schema.safeParse({ session: '1', ask: 'bar chart', proposal: maxTitle }).success).toBe(
      true,
    );
  });

  it('sources template manifests through the intelligence provider seam, not raw loadManifests', async () => {
    // All four binder tools obtain manifests through bundledIntelligenceProvider so a
    // milestone-2 remote content-pack provider swaps in without editing any tool. The Map
    // handed to the binder must stay byte-identical to loadManifests(): re-keyed by
    // manifest.template (listTemplateManifests() is exactly [...loadManifests().values()]).
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(boundResult);
    const fakeManifest = { template: 'seam-probe' } as unknown as TemplateManifest;
    const listSpy = vi
      .spyOn(bundledIntelligenceProvider, 'listTemplateManifests')
      .mockReturnValue([fakeManifest]);

    await getToolResult({ session: '1', ask: 'bar chart of Sales by Region' });

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(binderModule.bindTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        manifests: new Map([['seam-probe', fakeManifest]]),
      }),
    );
  });
});

describe('bindTemplateTool bind recovery gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows the designed Call 1 propose to Call 2 proposal transition without consuming retry budget', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate)
      .mockResolvedValueOnce(proposeResult)
      .mockResolvedValueOnce(escalateResult);

    const call1 = await getToolResult({ session: '1', ask: 'bar chart of Revenue by Region' });
    const call2 = await getToolResult({
      session: '1',
      ask: 'bar chart of Revenue by Region',
      proposal: sampleProposal,
    });

    expect(call1.isError).toBe(false);
    expect(call2.isError).toBe(false);
    invariant(call2.content[0].type === 'text');
    expect(JSON.parse(call2.content[0].text).status).toBe('escalate');
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(2);
    expect(binderModule.bindTemplate).toHaveBeenCalledTimes(2);
    const record = sessionRouteState.getBindRecovery(
      '1',
      normalizeAskForMatch('bar chart of Revenue by Region'),
    );
    expect(record?.phase).toBe('proposal-attempted');
    expect(record?.attempts.map((attempt) => attempt.outcome)).toEqual(['propose', 'escalate']);
    expect(record?.attempts.map((attempt) => attempt.consumesRetryBudget)).toEqual([false, false]);
  });

  it('blocks a repeat proposal-absent call while awaiting the designed Call 2 proposal', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValueOnce(proposeResult);

    await getToolResult({ session: '1', ask: 'something weird' });
    const blocked = await getToolResult({ session: '1', ask: 'something weird' });

    expect(blocked.isError).toBe(true);
    invariant(blocked.content[0].type === 'text');
    const body = JSON.parse(blocked.content[0].text);
    expect(body.status).toBe('blocked');
    expect(body.reason).toBe('awaiting_proposal');
    expect(body.guidance).toContain('previous llm_input');
    expectStructuredBlock(blocked, { label: 'Pick a proposal or ask user', kind: 'prefill' });
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(1);
    expect(binderModule.bindTemplate).toHaveBeenCalledTimes(1);
  });

  it('repeats actionable ambiguous-measure choices when a bare ask is resubmitted', async () => {
    vi.mocked(externalDiscovery.discoverInstances).mockReturnValue([]);
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValueOnce(ambiguousGoalsProposeResult);
    const ask = 'symbol map of countries by goals scored';

    const proposed = await getToolResult({ session: '1', ask });
    const repeated = await getToolResult({ session: '1', ask });

    invariant(proposed.content[0].type === 'text');
    invariant(repeated.content[0].type === 'text');
    const proposedBody = JSON.parse(proposed.content[0].text);
    const repeatedBody = JSON.parse(repeated.content[0].text);
    expect(proposedBody.status).toBe('propose');
    expect(repeatedBody).toMatchObject({
      status: 'blocked',
      reason: 'awaiting_proposal',
      call_2_contract: proposedBody.call_2_contract,
    });
    expect(
      repeatedBody.call_2_contract.proposal_choices[0].slots.find(
        (slot: { slot_id: string }) => slot.slot_id === 'sales',
      ).compatible_field_names,
    ).toEqual(['Goals', 'Goals For', 'Goals Against', 'Goal Difference']);
    expect(
      repeatedBody.call_2_contract.proposal_choices[0].slots.find(
        (slot: { slot_id: string }) => slot.slot_id === 'sales',
      ).compatible_field_options,
    ).toEqual([
      { name: 'Goals', label: 'Goals (from players.csv)' },
      { name: 'Goals For', label: 'Goals For (from standings.csv)' },
      { name: 'Goals Against', label: 'Goals Against (from standings.csv)' },
    ]);
    expect(repeatedBody.guidance).toContain('Do not resubmit the bare ask');
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(1);
    expect(binderModule.bindTemplate).toHaveBeenCalledTimes(1);
  });

  it('terminates on the second consecutive bare resubmit with an actionable fallback', async () => {
    vi.mocked(externalDiscovery.discoverInstances).mockReturnValue([]);
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValueOnce(ambiguousGoalsProposeResult);
    const ask = 'symbol map of countries by goals scored';

    const proposed = await getToolResult({ session: '1', ask });
    const firstBareResubmit = await getToolResult({ session: '1', ask, auto_apply: true });
    const terminal = await getToolResult({ session: '1', ask, auto_apply: true });

    invariant(proposed.content[0].type === 'text');
    invariant(firstBareResubmit.content[0].type === 'text');
    invariant(terminal.content[0].type === 'text');
    const proposedBody = JSON.parse(proposed.content[0].text);
    expect(JSON.parse(firstBareResubmit.content[0].text).reason).toBe('awaiting_proposal');
    expect(JSON.parse(terminal.content[0].text)).toMatchObject({
      status: 'blocked',
      reason: 'fallback_required',
      call_2_contract: proposedBody.call_2_contract,
    });
    expect(JSON.parse(terminal.content[0].text).guidance).toContain('build-and-apply-worksheet');
    expectStructuredBlock(terminal, { label: 'Use build-and-apply-worksheet', kind: 'prefill' });
    expect(sessionRouteState.getBindRecovery('1', normalizeAskForMatch(ask))).toMatchObject({
      phase: 'terminal',
      consecutiveBareResubmitCount: 2,
    });
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(1);
    expect(binderModule.bindTemplate).toHaveBeenCalledTimes(1);
  });

  it('resets the bare-resubmit counter when a filled proposal is supplied', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate)
      .mockResolvedValueOnce(proposeResult)
      .mockResolvedValueOnce(escalateResult);
    const ask = 'bar chart of Revenue by Region';
    const askKey = normalizeAskForMatch(ask);

    await getToolResult({ session: '1', ask });
    await getToolResult({ session: '1', ask, auto_apply: true });
    const corrected = await getToolResult({
      session: '1',
      ask,
      proposal: sampleProposal,
    });

    invariant(corrected.content[0].type === 'text');
    expect(JSON.parse(corrected.content[0].text).status).toBe('escalate');
    expect(sessionRouteState.getBindRecovery('1', askKey)?.consecutiveBareResubmitCount ?? 0).toBe(
      0,
    );

    const restartedBareResubmit = await getToolResult({ session: '1', ask, auto_apply: true });

    invariant(restartedBareResubmit.content[0].type === 'text');
    expect(JSON.parse(restartedBareResubmit.content[0].text).reason).toBe('awaiting_proposal');
    expect(sessionRouteState.getBindRecovery('1', askKey)).toMatchObject({
      phase: 'proposal-attempted',
      consecutiveBareResubmitCount: 1,
    });
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(2);
    expect(binderModule.bindTemplate).toHaveBeenCalledTimes(2);
  });

  it('blocks a same-signature retry, including title-only and confidence-only changes', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate)
      .mockResolvedValueOnce(proposeResult)
      .mockResolvedValueOnce(escalateResult);

    await getToolResult({ session: '1', ask: 'bar chart of Revenue by Region' });
    await getToolResult({
      session: '1',
      ask: 'bar chart of Revenue by Region',
      proposal: sampleProposal,
    });
    const blocked = await getToolResult({
      session: '1',
      ask: 'bar chart of Revenue by Region',
      proposal: sampleProposalTitleOnlyChange,
    });

    expect(blocked.isError).toBe(true);
    invariant(blocked.content[0].type === 'text');
    const body = JSON.parse(blocked.content[0].text);
    expect(body.status).toBe('blocked');
    expect(body.reason).toBe('unchanged_proposal');
    expect(body.guidance).toContain('Title/confidence only changes do not count');
    expectStructuredBlock(blocked, { label: 'Change proposal or ask user', kind: 'prefill' });
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(2);
    expect(binderModule.bindTemplate).toHaveBeenCalledTimes(2);
  });

  it('blocks an identical Call 2 retry when the admitted Call 2 fails before binding', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValueOnce(proposeResult);
    const getExecutor = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('desktop unavailable'))
      .mockResolvedValue({});

    await getToolResult({
      session: '1',
      ask: 'bar chart of Revenue by Region',
      getExecutor,
    });
    const failed = await getToolResult({
      session: '1',
      ask: 'bar chart of Revenue by Region',
      proposal: sampleProposal,
      getExecutor,
    });
    const blocked = await getToolResult({
      session: '1',
      ask: 'bar chart of Revenue by Region',
      proposal: sampleProposalTitleOnlyChange,
      getExecutor,
    });

    expect(failed.isError).toBe(true);
    expect(blocked.isError).toBe(true);
    invariant(blocked.content[0].type === 'text');
    const body = JSON.parse(blocked.content[0].text);
    expect(body.status).toBe('blocked');
    expect(body.reason).toBe('unchanged_proposal');
    expect(getExecutor).toHaveBeenCalledTimes(2);
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(1);
    expect(binderModule.bindTemplate).toHaveBeenCalledTimes(1);
  });

  it('blocks a same-signature Call 2 while the first admitted Call 2 is still in flight', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate)
      .mockResolvedValueOnce(proposeResult)
      .mockResolvedValueOnce(escalateResult);
    let resolveExecutor!: (executor: object) => void;
    const pendingExecutor = new Promise<object>((resolve) => {
      resolveExecutor = resolve;
    });
    const getExecutor = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockReturnValueOnce(pendingExecutor)
      .mockResolvedValue({});

    await getToolResult({
      session: '1',
      ask: 'bar chart of Revenue by Region',
      getExecutor,
    });
    const inFlight = getToolResult({
      session: '1',
      ask: 'bar chart of Revenue by Region',
      proposal: sampleProposal,
      getExecutor,
    });
    await vi.waitFor(() => expect(getExecutor).toHaveBeenCalledTimes(2));

    const blocked = await getToolResult({
      session: '1',
      ask: 'bar chart of Revenue by Region',
      proposal: sampleProposalTitleOnlyChange,
      getExecutor,
    });

    expect(blocked.isError).toBe(true);
    invariant(blocked.content[0].type === 'text');
    const blockedBody = JSON.parse(blocked.content[0].text);
    expect(blockedBody.status).toBe('blocked');
    expect(blockedBody.reason).toBe('unchanged_proposal');
    expect(getExecutor).toHaveBeenCalledTimes(2);

    resolveExecutor({});
    const completed = await inFlight;
    invariant(completed.content[0].type === 'text');
    expect(JSON.parse(completed.content[0].text).status).toBe('escalate');
  });

  it('correlates concurrent different-signature Call 2 outcomes to their own reservations', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    let resolveFirstCall2!: (result: BinderResult) => void;
    let resolveSecondCall2!: (result: BinderResult) => void;
    const firstCall2Bind = new Promise<BinderResult>((resolve) => {
      resolveFirstCall2 = resolve;
    });
    const secondCall2Bind = new Promise<BinderResult>((resolve) => {
      resolveSecondCall2 = resolve;
    });
    vi.mocked(binderModule.bindTemplate)
      .mockResolvedValueOnce(proposeResult)
      .mockImplementationOnce(() => firstCall2Bind)
      .mockImplementationOnce(() => secondCall2Bind);
    const getExecutor = vi.fn().mockResolvedValue({});
    const ask = 'bar chart of Revenue by Region';
    const askKey = normalizeAskForMatch(ask);

    await getToolResult({ session: '1', ask, getExecutor });
    const firstCall2 = getToolResult({
      session: '1',
      ask,
      proposal: sampleProposal,
      getExecutor,
    });
    await vi.waitFor(() => expect(binderModule.bindTemplate).toHaveBeenCalledTimes(2));
    const secondCall2 = getToolResult({
      session: '1',
      ask,
      proposal: changedProposal,
      getExecutor,
    });
    await vi.waitFor(() => expect(binderModule.bindTemplate).toHaveBeenCalledTimes(3));

    resolveSecondCall2(escalateResult);
    const secondCompleted = await secondCall2;
    resolveFirstCall2(escalateResult);
    const firstCompleted = await firstCall2;

    invariant(firstCompleted.content[0].type === 'text');
    invariant(secondCompleted.content[0].type === 'text');
    expect(JSON.parse(firstCompleted.content[0].text).status).toBe('escalate');
    expect(JSON.parse(secondCompleted.content[0].text).status).toBe('escalate');
    const record = sessionRouteState.getBindRecovery('1', askKey)!;
    expect(record.phase).toBe('retry-used');
    expect(record.lastProposalSignature).toBe(proposalSignature(changedProposal));
    expect(record.attempts).toMatchObject([
      { outcome: 'propose', consumesRetryBudget: false },
      { outcome: 'escalate', consumesRetryBudget: false },
      { outcome: 'escalate', consumesRetryBudget: true },
    ]);
    expect(record.attempts.some((attempt) => attempt.outcome === undefined)).toBe(false);
    expect(record.attempts.map((attempt) => attempt.outcome)).toEqual([
      'propose',
      'escalate',
      'escalate',
    ]);
    expect(serializeRouteReceipt(sessionRouteState.get('1'))?.bind_attempts).toEqual({
      count: 3,
      outcomes: ['propose', 'escalate', 'escalate'],
      phase: 'retry-used',
      retry_budget_consumed: 1,
    });
  });

  it('allows genuinely new corrected proposals and then blocks repeated signatures', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate)
      .mockResolvedValueOnce(proposeResult)
      .mockResolvedValueOnce(escalateResult)
      .mockResolvedValueOnce(escalateResult)
      .mockResolvedValueOnce(escalateResult);

    await getToolResult({ session: '1', ask: 'bar chart of Revenue by Region' });
    await getToolResult({
      session: '1',
      ask: 'bar chart of Revenue by Region',
      proposal: sampleProposal,
    });
    const changedRetry = await getToolResult({
      session: '1',
      ask: 'bar chart of Revenue by Region',
      proposal: changedProposal,
    });
    const changedAgainRetry = await getToolResult({
      session: '1',
      ask: 'bar chart of Revenue by Region',
      proposal: changedProposalAgain,
    });
    const repeated = await getToolResult({
      session: '1',
      ask: 'bar chart of Revenue by Region',
      proposal: changedProposalAgain,
    });
    const repeatedAgain = await getToolResult({
      session: '1',
      ask: 'bar chart of Revenue by Region',
      proposal: changedProposalAgain,
    });

    expect(changedRetry.isError).toBe(false);
    invariant(changedRetry.content[0].type === 'text');
    expect(JSON.parse(changedRetry.content[0].text).status).toBe('escalate');
    expect(changedAgainRetry.isError).toBe(false);
    invariant(changedAgainRetry.content[0].type === 'text');
    expect(JSON.parse(changedAgainRetry.content[0].text).status).toBe('escalate');
    expect(repeated.isError).toBe(true);
    expect(repeatedAgain.isError).toBe(true);
    invariant(repeated.content[0].type === 'text');
    const body = JSON.parse(repeated.content[0].text);
    expect(body.status).toBe('blocked');
    expect(body.reason).toBe('retry_budget_exhausted');
    expect(body.guidance).toContain('repeats an attempted signature');
    expectStructuredBlock(repeated, { label: 'Use fallback path or ask user', kind: 'prefill' });
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(4);
    expect(binderModule.bindTemplate).toHaveBeenCalledTimes(4);
    const record = sessionRouteState.getBindRecovery(
      '1',
      normalizeAskForMatch('bar chart of Revenue by Region'),
    );
    expect(record?.phase).toBe('retry-used');
    expect(record?.attempts.map((attempt) => attempt.consumesRetryBudget)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it('routes Tier-2 escalation straight to fallback and closes the retry path', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate)
      .mockResolvedValueOnce(proposeResult)
      .mockResolvedValueOnce(tier2EscalateResult);

    await getToolResult({ session: '1', ask: 'unsupported chart' });
    const tier2 = await getToolResult({
      session: '1',
      ask: 'unsupported chart',
      proposal: sampleProposal,
    });
    const blocked = await getToolResult({
      session: '1',
      ask: 'unsupported chart',
      proposal: changedProposal,
    });

    invariant(tier2.content[0].type === 'text');
    const tier2Body = JSON.parse(tier2.content[0].text);
    expect(tier2Body.status).toBe('escalate');
    expect(tier2Body.guidance).toContain('No fast-path template fits this ask/data');
    expect(tier2Body.guidance).toContain('build-and-apply-worksheet');
    expect(tier2Body.guidance).not.toContain('corrected proposal');
    expect(blocked.isError).toBe(true);
    invariant(blocked.content[0].type === 'text');
    const blockedBody = JSON.parse(blocked.content[0].text);
    expect(blockedBody.status).toBe('blocked');
    expect(blockedBody.reason).toBe('fallback_required');
    expect(blockedBody.guidance).toContain('not recoverable in the fast path');
    expectStructuredBlock(blocked, { label: 'Use fallback authoring path', kind: 'prefill' });
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(2);
    expect(binderModule.bindTemplate).toHaveBeenCalledTimes(2);
  });

  it('clears the recovery record after a terminal bound result', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate)
      .mockResolvedValueOnce(proposeResult)
      .mockResolvedValueOnce(boundResult);
    const ask = 'bar chart of Sales by Region';

    await getToolResult({ session: '1', ask });
    expect(sessionRouteState.getBindRecovery('1', normalizeAskForMatch(ask))?.phase).toBe(
      'awaiting-proposal',
    );

    const bound = await getToolResult({ session: '1', ask, proposal: sampleProposal });

    expect(bound.isError).toBe(false);
    invariant(bound.content[0].type === 'text');
    expect(JSON.parse(bound.content[0].text).status).toBe('bound');
    expect(sessionRouteState.getBindRecovery('1', normalizeAskForMatch(ask))).toBeUndefined();
  });

  it('does not label proposal-absent non-Tier-2 escalation as awaiting a proposal', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(escalateResult);
    const ask = 'bar chart of Revenue by Region';

    const first = await getToolResult({ session: '1', ask });
    const second = await getToolResult({ session: '1', ask });

    invariant(first.content[0].type === 'text');
    invariant(second.content[0].type === 'text');
    expect(JSON.parse(first.content[0].text).status).toBe('escalate');
    const secondBody = JSON.parse(second.content[0].text);
    expect(secondBody.status).toBe('escalate');
    expect(secondBody.status).not.toBe('blocked');
    expect(sessionRouteState.getBindRecovery('1', normalizeAskForMatch(ask))).toBeUndefined();
    expect(getWorkbookXmlModule.getWorkbookXml).toHaveBeenCalledTimes(2);
    expect(binderModule.bindTemplate).toHaveBeenCalledTimes(2);
  });
});

async function getToolResult({
  session,
  ask,
  proposal,
  minConfidence,
  auto_apply,
  target_worksheet,
  calcs,
  customSignal,
  getExecutor,
}: {
  // Optional: omitted exercises session-default-when-unique resolution.
  session?: string;
  ask: string;
  // The tool schema requires confidence even though the library type leaves it optional.
  proposal?: BindingProposal & { confidence: number };
  minConfidence?: number;
  auto_apply?: boolean;
  target_worksheet?: string;
  calcs?: Array<{
    caption: string;
    formula: string;
    datatype?: string;
    role?: string;
  }>;
  customSignal?: AbortSignal;
  getExecutor?: TableauDesktopToolContext['getExecutor'];
}): Promise<CallToolResult> {
  const tool = getBindTemplateTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);

  const mockExecutor: TableauDesktopToolContext['getExecutor'] =
    getExecutor ?? vi.fn().mockResolvedValue({});
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: mockExecutor,
    ...(customSignal && { signal: customSignal }),
  };

  return await callback(
    { session, ask, proposal, minConfidence, auto_apply, target_worksheet, calcs } as any,
    extra,
  );
}

/**
 * Wire the auto-apply seams for one bind-template call. Returns the executor's
 * command/document spies and the `getExecutor` factory to hand
 * to {@link getToolResult}. Defaults reproduce a happy Call-1 bind of a fast-path
 * template whose inject succeeds and whose validated apply dispatches Ok.
 */
function setupAutoApplyMocks({
  bind = boundResult,
  fastPathEligible = true,
  inject = { ok: true as const, xml: '<workbook/>' },
  validationValid = true,
  dispatch = Ok({ command_id: 'cmd-1', status: 'completed', submitted_at: '', result: {} }),
  activationDispatch,
  workbookReads = [XML],
  // Events-clean gate (W60): 0 = clean workbook (gate passes); N>0 = the user touched
  // the workbook between read and apply; 'unsupported' = executor without events
  // (gate is best-effort and must NOT block auto_apply).
  userEventsDuringBind = 0,
}: {
  bind?: BinderResult;
  fastPathEligible?: boolean;
  inject?: { ok: true; xml: string; warnings?: string[] } | { ok: false; issues: string[] };
  validationValid?: boolean;
  dispatch?: ReturnType<typeof Ok> | ReturnType<typeof Err>;
  activationDispatch?: ReturnType<typeof Ok> | ReturnType<typeof Err>;
  workbookReads?: string[];
  userEventsDuringBind?: number | 'unsupported';
} = {}): {
  executeCommand: ReturnType<typeof vi.fn>;
  applyWorkbookDocument: ReturnType<typeof vi.fn>;
  getEvents: ReturnType<typeof vi.fn>;
  getExecutor: ReturnType<typeof vi.fn>;
} {
  let liveXml = workbookReads[0] ?? XML;
  let workbookReadIndex = 0;
  vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockImplementation(async () => {
    if (workbookReadIndex < workbookReads.length) {
      liveXml = workbookReads[workbookReadIndex++];
    }
    return Ok(liveXml);
  });
  vi.mocked(binderModule.bindTemplate).mockResolvedValue(bind);
  vi.spyOn(bundledIntelligenceProvider, 'listTemplateManifests').mockReturnValue([
    {
      template: bind.status === 'bound' ? bind.args.template_name : 'bar-basic',
      fast_path_eligible: fastPathEligible,
    } as unknown as TemplateManifest,
  ]);
  vi.mocked(readTemplate).mockReturnValue('<template/>');
  vi.mocked(buildInjectedWorkbookXml).mockReturnValue(inject);
  // Force loadWorkbookXml down its text branch so the real validated path runs
  // without touching the on-disk JSON cache (DesktopCache mkdirs in its ctor).
  vi.mocked(xmlToJsonModule.xmlToJson).mockImplementation(() => {
    throw new Error('force text path');
  });
  vi.mocked(validationRegistry.runValidation).mockReturnValue(
    validationValid
      ? { valid: true, issues: [] }
      : { valid: false, issues: [{ ruleId: 'r', severity: 'error', message: 'boom' }] },
  );

  const executeCommand = vi.fn().mockResolvedValue(activationDispatch ?? dispatch);
  const applyWorkbookDocument = vi.fn(async (xml: string) => {
    if (dispatch.isOk()) {
      liveXml = xml;
    }
    return dispatch;
  });
  const getEvents =
    userEventsDuringBind === 'unsupported'
      ? vi.fn().mockResolvedValue(Err('events unsupported on this transport'))
      : vi
          .fn()
          // 1st: pre-bind anchor. 2nd: pre-apply cleanliness. 3rd: post-apply reuse anchor.
          .mockResolvedValueOnce(Ok({ events: [], latest_sequence: 41, count: 0 }))
          .mockResolvedValue(
            Ok({
              events: Array.from({ length: userEventsDuringBind }, (_, i) => ({ id: i })),
              latest_sequence: 41 + userEventsDuringBind,
              count: userEventsDuringBind,
            }),
          );
  const getExecutor = vi.fn().mockResolvedValue({
    executeCommand,
    applyWorkbookDocument,
    getEvents,
  });
  return { executeCommand, applyWorkbookDocument, getEvents, getExecutor };
}

// Route per-sheet readback through the whole-workbook fallback used by older Desktop hosts.
const routeMissing = (): ReturnType<typeof Err> =>
  Err({
    type: 'command-failed',
    error: { code: 'not-found', message: 'No route matches /worksheets' },
  });

function readbackExecutor(base: {
  executeCommand: ReturnType<typeof vi.fn>;
  applyWorkbookDocument: ReturnType<typeof vi.fn>;
  getEvents: ReturnType<typeof vi.fn>;
}): TableauDesktopToolContext['getExecutor'] {
  return vi.fn().mockResolvedValue({
    executeCommand: base.executeCommand,
    applyWorkbookDocument: base.applyWorkbookDocument,
    getEvents: base.getEvents,
    listWorksheets: vi.fn(routeMissing),
  });
}

function summaryRowsExecutor(
  base: {
    executeCommand: ReturnType<typeof vi.fn>;
    applyWorkbookDocument: ReturnType<typeof vi.fn>;
    getEvents: ReturnType<typeof vi.fn>;
  },
  summary:
    | { columns: Array<Record<string, unknown>>; rows: unknown[][] }
    | ReturnType<typeof Err>
    | 'pending',
): TableauDesktopToolContext['getExecutor'] {
  const getWorksheetSummaryData =
    summary === 'pending'
      ? vi.fn().mockReturnValue(new Promise(() => undefined))
      : 'isErr' in summary
        ? vi.fn().mockResolvedValue(summary)
        : vi
            .fn()
            .mockImplementation(async (_worksheetId: string, options: { maxRows: number }) =>
              Ok({ ...summary, rows: summary.rows.slice(0, options.maxRows) }),
            );
  return vi.fn().mockResolvedValue({
    executeCommand: base.executeCommand,
    applyWorkbookDocument: base.applyWorkbookDocument,
    getEvents: base.getEvents,
    listWorksheets: vi.fn().mockResolvedValue(
      Ok({
        worksheets: [
          {
            id: 'sheet-sales',
            name: 'Sales by Region',
            datasources: [{ id: 'superstore', name: 'Superstore' }],
          },
        ],
      }),
    ),
    getWorksheetDocument: vi.fn(routeMissing),
    getWorksheetSummaryData,
  });
}

describe('bindTemplateTool auto_apply gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(externalDiscovery.discoverInstances).mockReturnValue([]);
  });

  it('auto_apply=false leaves today’s read-only bound result byte-compatible (no apply)', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks();

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: false,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body).toEqual({
      ...boundResult,
      guidance: boundResult.status === 'bound' ? boundResult.apply_instruction : '',
    });
    expect(buildInjectedWorkbookXml).not.toHaveBeenCalled();
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('auto-applies a recommended ranking proposal in one call and discloses the default', async () => {
    const mocks = setupAutoApplyMocks({
      bind: recommendedProposeResult,
      inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML },
      workbookReads: [RANKING_CONTEXT_WORKBOOK_XML],
    });
    vi.mocked(binderModule.bindTemplate)
      .mockResolvedValueOnce(recommendedProposeResult)
      .mockResolvedValueOnce(boundWithTopNResult);

    const result = await getToolResult({
      session: '1',
      ask: 'Show me our top customers.',
      auto_apply: true,
      getExecutor: summaryRowsExecutor(mocks, {
        columns: [
          { name: 'Customer Name', dataType: 'string' },
          { name: 'Sales', dataType: 'real' },
          { name: 'Profit', dataType: 'real' },
        ],
        rows: [['Acme', 100, -75000]],
      }),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body).toMatchObject({
      status: 'bound',
      applied: true,
      applied_default: {
        measure: 'Sales',
        top_n: 10,
        reason: 'revenue-like measure; top-N defaults to 10',
        context_measures: ['Profit'],
      },
      summary_rows: {
        columns: [
          { name: 'Customer Name', dataType: 'string' },
          { name: 'Sales', dataType: 'real' },
          { name: 'Profit', dataType: 'real' },
        ],
        rows: [['Acme', 100, -75000]],
      },
    });
    expect(body.guidance).toContain('not the user’s stated choice');
    expect(body.guidance).toContain('Sales');
    expect(body.guidance).toContain('top 10');
    expect(body.guidance).toContain('change the measure or top_n');
    expect(body.guidance).toContain(
      'also quote notable values of the context measures for the top entries',
    );
    expect(appliedXml(mocks.applyWorkbookDocument)).toContain(
      '<tooltip column="[Superstore].[sum:Profit:qk]"></tooltip>',
    );
    expect(binderModule.bindTemplate).toHaveBeenCalledTimes(2);
    expect(binderModule.bindTemplate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        proposal: {
          template: 'bar-basic',
          title: 'Show me our top customers.',
          bindings: [
            { slot_id: 'cat', field: 'Region' },
            { slot_id: 'val', field: 'Sales' },
          ],
          confidence: 1,
          top_n: 10,
        },
      }),
    );
  });

  it('carries the context-measure default when an explicit Call-2 proposal lands on the recommended measure', async () => {
    const mocks = setupAutoApplyMocks({
      bind: boundWithTopNResult,
      inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML },
      workbookReads: [RANKING_CONTEXT_WORKBOOK_XML],
    });
    vi.mocked(binderModule.bindTemplate)
      .mockResolvedValueOnce(boundWithTopNResult)
      .mockResolvedValueOnce(recommendedProposeResult);

    const result = await getToolResult({
      session: '1',
      ask: 'Show me our top customers.',
      auto_apply: true,
      proposal: {
        template: 'bar-basic',
        title: 'Show me our top customers.',
        bindings: [
          { slot_id: 'cat', field: 'Region' },
          { slot_id: 'val', field: 'Sales' },
        ],
        confidence: 1,
        top_n: 10,
      },
      getExecutor: summaryRowsExecutor(mocks, {
        columns: [
          { name: 'Customer Name', dataType: 'string' },
          { name: 'Sales', dataType: 'real' },
          { name: 'Profit', dataType: 'real' },
        ],
        rows: [['Acme', 100, -75000]],
      }),
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body).toMatchObject({
      status: 'bound',
      applied: true,
      applied_default: {
        measure: 'Sales',
        context_measures: ['Profit'],
      },
    });
    expect(appliedXml(mocks.applyWorkbookDocument)).toContain(
      '<tooltip column="[Superstore].[sum:Profit:qk]"></tooltip>',
    );
    expect(binderModule.bindTemplate).toHaveBeenCalledTimes(2);
  });

  it('adds one currency caveat when a summed measure omits the currency dimension', async () => {
    const mocks = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML },
      workbookReads: [CURRENCY_WORKBOOK_XML],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor: summaryRowsExecutor(mocks, {
        columns: [
          { name: 'Region', dataType: 'string' },
          { name: 'Sales', dataType: 'real' },
        ],
        rows: [['West', 1200]],
      }),
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    const caveat =
      'Note: [Sales] is summed across [Currency Code] without conversion — state this assumption in one line.';
    expect(body.guidance).toContain(caveat);
    expect(body.guidance.match(/without conversion/g)).toHaveLength(1);
  });

  it('omits the currency caveat when the currency dimension is on color', async () => {
    const mocks = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_RANKING_WITH_CURRENCY_COLOR_XML },
      workbookReads: [CURRENCY_WORKBOOK_XML],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor: summaryRowsExecutor(mocks, {
        columns: [
          { name: 'Region', dataType: 'string' },
          { name: 'Currency Code', dataType: 'string' },
          { name: 'Sales', dataType: 'real' },
        ],
        rows: [['West', 'USD', 1200]],
      }),
    });

    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).guidance).not.toContain('without conversion');
  });

  it('omits the currency caveat when the datasource has no currency dimension', async () => {
    const mocks = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML },
      workbookReads: [RANKING_CONTEXT_WORKBOOK_XML],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor: summaryRowsExecutor(mocks, {
        columns: [
          { name: 'Region', dataType: 'string' },
          { name: 'Sales', dataType: 'real' },
        ],
        rows: [['West', 1200]],
      }),
    });

    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).guidance).not.toContain('without conversion');
  });

  it('omits the currency caveat when the view has no summed measure', async () => {
    const mocks = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_RANKING_WITH_AVERAGE_XML },
      workbookReads: [CURRENCY_WORKBOOK_XML],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'average Sales by Region',
      auto_apply: true,
      getExecutor: summaryRowsExecutor(mocks, {
        columns: [
          { name: 'Region', dataType: 'string' },
          { name: 'Sales', dataType: 'real' },
        ],
        rows: [['West', 1200]],
      }),
    });

    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).guidance).not.toContain('without conversion');
  });

  it('auto_apply=true on a standalone Call-1 bind applies then issues validated goto-sheet', async () => {
    const { executeCommand, applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_WORKBOOK_WITH_NEW_SHEET_WINDOW },
    });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(true);
    expect(body.sheet_name).toBe('Sales by Region');
    expect(typeof body.phase_ms.bind).toBe('number');
    expect(typeof body.phase_ms.inject).toBe('number');
    expect(typeof body.phase_ms.apply).toBe('number');
    // W60 response-shape trim (P4): the applied:true fast-path drops the args echo — the
    // manual second call it enabled never happens on success.
    expect(body.args).toBeUndefined();

    expect(buildInjectedWorkbookXml).toHaveBeenCalledTimes(1);
    expect(buildInjectedWorkbookXml).toHaveBeenCalledWith(
      expect.objectContaining({
        workbookXml: XML,
        templateXml: '<template/>',
        title: 'Sales by Region',
        sheetType: 'worksheet',
        fieldMapping: { cat: '[Region]', val: '[Sales]' },
        applyNonce: expect.any(String),
      }),
    );
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
    const primaryWindows = normalizeArray<ParsedWindow>(
      parseXML(appliedXmlAt(applyWorkbookDocument, 0)).workbook?.windows?.window,
    );
    expect(primaryWindows.find((window) => window['@_name'] === 'Old Sheet')).toMatchObject({
      '@_active': 'true',
      '@_maximized': 'true',
    });
    expect(
      primaryWindows.find((window) => window['@_name'] === 'Sales by Region'),
    ).not.toMatchObject({
      '@_active': 'true',
      '@_maximized': 'true',
    });
    expect(executeCommand).toHaveBeenCalledWith({
      namespace: 'tabdoc',
      command: 'goto-sheet',
      args: { Sheet: 'Sales by Region' },
      signal: expect.any(AbortSignal),
    });
  });

  it('auto_apply=true validates the brand-new worksheet and reissues focus when the first goto does not land', async () => {
    const { executeCommand, applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_WORKBOOK_WITH_NEW_SHEET_WINDOW },
    });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    // One bind read, then one read per validated navigation pass: the first dispatches, the
    // second reads back, sees the goto did not land in this fixture, and reissues once.
    expect(vi.mocked(getWorkbookXmlModule.getWorkbookXml)).toHaveBeenCalledTimes(3);
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
    expect(executeCommand).toHaveBeenCalledTimes(2);
    expect(executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'goto-sheet',
        args: { Sheet: 'Sales by Region' },
      }),
    );
  });

  it('activation failure preserves the applied:true response envelope byte-for-byte', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const logSpy = vi.spyOn(loggerModule, 'log').mockImplementation(() => undefined);
    const { executeCommand, applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_WORKBOOK_WITH_NEW_SHEET_WINDOW },
      activationDispatch: Err({ type: 'command-timed-out', error: 'activation timeout' }),
    });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      JSON.stringify({
        status: 'bound',
        guidance:
          'Applied "Sales by Region" to the live workbook (bind 0ms, inject 0ms, apply 0ms). Done — no further tool calls needed.',
        applied: true,
        sheet_name: 'Sales by Region',
        phase_ms: { bind: 0, inject: 0, apply: 0 },
        summary_rows_error: 'activeExecutor.listWorksheets is not a function',
      }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warning',
        data: expect.objectContaining({ sheetName: 'Sales by Region' }),
      }),
    );
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
    expect(executeCommand).toHaveBeenCalledTimes(1);
  });

  it('applied:true returns ONLY the trimmed fast-path shape (W60 P4 response-shape trim)', async () => {
    const mocks = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML },
    });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor: readbackExecutor(mocks),
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
    // Keep only what a successful apply needs; drop args + the ~170-token
    // apply_instruction + apply_hint + used_llm (dead weight on the success fast path).
    expect(Object.keys(body).sort()).toEqual([
      'applied',
      'guidance',
      'phase_ms',
      'sheet_name',
      'status',
      'summary_rows_error',
    ]);
    expect(body.status).toBe('bound');
    expect(body.apply_instruction).toBeUndefined();
    expect(body.apply_hint).toBeUndefined();
    expect(body.used_llm).toBeUndefined();
    // A real clean readback appends the host receipt; budget that measured path rather than
    // passing because a mock omitted listWorksheets and silently skipped verification.
    expect(typeof body.guidance).toBe('string');
    expect(body.guidance).toContain('HOST VERIFICATION — verified');
    expect((body.guidance as string).length).toBeLessThan(400);
  });

  it('marks 21 source rows truncated while returning 20 summary rows', async () => {
    const mocks = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML },
    });
    const rows = Array.from({ length: 21 }, (_, index) => [`Region ${index}`, index * 100]);

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor: summaryRowsExecutor(mocks, {
        columns: [
          { name: 'Region', dataType: 'string' },
          { name: 'Sales', dataType: 'real' },
        ],
        rows,
      }),
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(true);
    expect(body.summary_rows).toEqual({
      columns: [
        { name: 'Region', dataType: 'string' },
        { name: 'Sales', dataType: 'real' },
      ],
      rows: rows.slice(0, 20),
    });
    expect(body.truncated).toBe(true);
  });

  it('omits truncated for exactly 20 source rows', async () => {
    const mocks = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML },
    });
    const rows = Array.from({ length: 20 }, (_, index) => [`Region ${index}`, index * 100]);

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor: summaryRowsExecutor(mocks, {
        columns: [
          { name: 'Region', dataType: 'string' },
          { name: 'Sales', dataType: 'real' },
        ],
        rows,
      }),
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(true);
    expect(body.summary_rows.rows).toEqual(rows);
    expect(body.truncated).toBeUndefined();
  });

  it('caps serialized summary_rows near 2KB and marks truncation', async () => {
    const mocks = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML },
    });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor: summaryRowsExecutor(mocks, {
        columns: [
          { name: 'Region', dataType: 'string' },
          { name: 'Narrative', dataType: 'string' },
        ],
        rows: Array.from({ length: 20 }, (_, index) => [`Region ${index}`, 'x'.repeat(400)]),
      }),
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(body.summary_rows), 'utf8')).toBeLessThanOrEqual(2048);
    expect(body.summary_rows.rows.length).toBeGreaterThan(0);
    expect(body.summary_rows.rows.length).toBeLessThan(20);
  });

  it('truncates a monster cell before sizing summary_rows', async () => {
    const mocks = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML },
    });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor: summaryRowsExecutor(mocks, {
        columns: [
          { name: 'Region', dataType: 'string' },
          { name: 'Narrative', dataType: 'string' },
        ],
        rows: [['West', 'x'.repeat(1_000_000)]],
      }),
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(true);
    expect(body.summary_rows_error).toBeUndefined();
    expect(body.summary_rows.rows).toEqual([['West', 'x'.repeat(256)]]);
    expect(Buffer.byteLength(JSON.stringify(body.summary_rows), 'utf8')).toBeLessThanOrEqual(2048);
    expect(body.truncated).toBe(true);
  });

  it('drops a single capped row that still exceeds the summary_rows byte budget', async () => {
    const mocks = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML },
    });
    const columns = Array.from({ length: 10 }, (_, index) => ({
      name: `Narrative ${index}`,
      dataType: 'string',
    }));

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor: summaryRowsExecutor(mocks, {
        columns,
        rows: [columns.map(() => 'x'.repeat(1_000_000))],
      }),
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(true);
    expect(body.summary_rows).toBeUndefined();
    expect(body.summary_rows_error).toBe('oversize readback');
  });

  it('treats zero summary rows as inconclusive without failing the bind', async () => {
    const mocks = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML },
    });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor: summaryRowsExecutor(mocks, { columns: [], rows: [] }),
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(true);
    expect(body.summary_rows).toBeUndefined();
    expect(body.summary_rows_error).toBe('empty readback — verify with get-summary-data');
    expect(body.guidance).toContain('Summary readback returned zero rows');
    expect(body.guidance).toContain('check the sheet');
    expect(body.guidance).not.toContain('no further tool calls');
    expect(result.structuredContent?.nextAction).not.toMatchObject({ kind: 'done' });
  });

  it('keeps bind success and reports summary_rows_error when readback fails', async () => {
    const mocks = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML },
    });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor: summaryRowsExecutor(
        mocks,
        Err({
          type: 'command-failed',
          error: { code: 'summary-unavailable', message: 'summary endpoint unavailable' },
        }),
      ),
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(true);
    expect(body.sheet_name).toBe('Sales by Region');
    expect(body.summary_rows).toBeUndefined();
    expect(body.summary_rows_error).toContain('summary endpoint unavailable');
    expect(body.guidance).toContain('no further tool calls');
    expect(result.structuredContent?.nextAction).toMatchObject({ kind: 'done' });
  });

  it('times out summary readback after 2s without failing a successful bind', async () => {
    vi.useFakeTimers();
    try {
      const mocks = setupAutoApplyMocks({
        inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML },
      });
      const resultPromise = getToolResult({
        session: '1',
        ask: 'bar chart of Sales by Region',
        auto_apply: true,
        getExecutor: summaryRowsExecutor(mocks, 'pending'),
      });

      await vi.advanceTimersByTimeAsync(2000);
      const result = await resultPromise;

      invariant(result.content[0].type === 'text');
      const body = JSON.parse(result.content[0].text);
      expect(body.applied).toBe(true);
      expect(body.summary_rows).toBeUndefined();
      expect(body.summary_rows_error).toBe('summary rows readback timed out after 2000ms');
    } finally {
      vi.useRealTimers();
    }
  });

  it('applied:true non-waterfall bind is terminal: guidance says done and nextAction.kind is "done"', async () => {
    // Blake's spiral: a completed auto-apply (symbol map, no unfilled re-bind slot) must
    // carry a terminal marker so the agent stops instead of burning 100s on search-commands
    // over an already-rendered chart. The prose stop-clause works with today's host; the
    // structuredContent.nextAction{kind:'done'} is the durable machine contract.
    const mocks = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML },
    });

    const result = await getToolResult({
      session: '1',
      ask: 'symbol map of Sales by State',
      auto_apply: true,
      getExecutor: readbackExecutor(mocks),
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.guidance).toContain('no further tool calls');
    expectStructuredBlock(result, COMPLETE_BIND_NEXT_ACTION);
    // structuredContent lives on the envelope, not in the JSON body.
    expect(Object.keys(body).sort()).toEqual([
      'applied',
      'guidance',
      'phase_ms',
      'sheet_name',
      'status',
      'summary_rows_error',
    ]);
    expect(body.guidance).toContain('HOST VERIFICATION — verified');
    expect((body.guidance as string).length).toBeLessThan(400);
  });

  it('auto_apply=true applies a validated Call-2 proposal bind with the events anchor', async () => {
    const { applyWorkbookDocument, getEvents, getExecutor } = setupAutoApplyMocks({
      bind: boundViaProposalResult,
    });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      proposal: sampleProposal,
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(true);
    expect(body.used_llm).toBeUndefined();
    expect(buildInjectedWorkbookXml).toHaveBeenCalledTimes(1);
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
    expect(getEvents).toHaveBeenCalledTimes(3);
    expect(getEvents).toHaveBeenNthCalledWith(2, {
      signal: expect.any(AbortSignal),
      sinceSequence: 41,
    });
    expect(getEvents).toHaveBeenNthCalledWith(3, {
      signal: expect.any(AbortSignal),
    });
  });

  it('completes the P&L propose to valid Call 2 to applied sequence', async () => {
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      bind: boundWaterfallResult,
      inject: { ok: true, xml: INJECTED_WATERFALL_WORKBOOK_XML },
      workbookReads: [P_AND_L_WORKBOOK_XML],
    });
    vi.mocked(binderModule.bindTemplate)
      .mockResolvedValueOnce(waterfallProposeResult)
      .mockResolvedValueOnce(boundWaterfallResult);
    const proposal: BindingProposal & { confidence: number } = {
      template: 'part-to-whole-waterfall',
      title: 'P&L Waterfall',
      bindings: [
        { slot_id: 'profit', field: 'amount' },
        { slot_id: 'sub_category', field: 'line_item' },
        { slot_id: 'anchor_category', field: 'category' },
      ],
      confidence: 0.95,
      sort: { by: 'display_order', direction: 'asc' },
    };

    const call1 = await getToolResult({
      session: '1',
      ask: 'P&L waterfall',
      auto_apply: true,
      getExecutor,
    });
    const call2 = await getToolResult({
      session: '1',
      ask: 'P&L waterfall',
      proposal,
      auto_apply: true,
      getExecutor,
    });

    invariant(call1.content[0].type === 'text');
    invariant(call2.content[0].type === 'text');
    expect(JSON.parse(call1.content[0].text).status).toBe('propose');
    expectStructuredBlock(call1, {
      label: 'Supply proposal from call_2_contract to bind-template',
      kind: 'prefill',
    });
    expect(JSON.parse(call2.content[0].text)).toMatchObject({
      status: 'bound',
      applied: true,
      sheet_name: 'P&L Waterfall',
    });
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
  });

  it('returns literal sheet_name and guidance after auto-applying an XML-escaped title', async () => {
    const escapedTitleResult: BinderResult = {
      ...boundResult,
      args: {
        ...boundResult.args,
        title: 'P&amp;L Waterfall: Revenue to Net Income',
      },
    };
    const { getExecutor } = setupAutoApplyMocks({ bind: escapedTitleResult });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of P&L',
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.sheet_name).toBe('P&L Waterfall: Revenue to Net Income');
    expect(body.guidance).toContain('Applied "P&L Waterfall: Revenue to Net Income"');
    expect(body.guidance).not.toContain('P&amp;L');
    expect(body.args).toBeUndefined();
  });

  it('auto_apply=true splices proposal sort into the applied workbook XML', async () => {
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      bind: boundWithSortResult,
      inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML },
    });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region sorted descending',
      proposal: { ...sampleProposal, sort: { by: 'Sales', direction: 'desc' } },
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    expect(appliedXml(applyWorkbookDocument)).toContain(
      "<computed-sort column='[Superstore].[none:Region:nk]' direction='DESC' using='[Superstore].[sum:Sales:qk]' />",
    );
  });

  it('auto_apply=true keeps the waterfall built-in sort when no sort proposal is present', async () => {
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      bind: boundWaterfallResult,
      inject: { ok: true, xml: INJECTED_WATERFALL_WORKBOOK_XML },
      workbookReads: [P_AND_L_WORKBOOK_XML],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'P&L waterfall',
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    expect(appliedXml(applyWorkbookDocument)).toContain(
      "<computed-sort column='[PL].[none:line_item:nk]' direction='DESC' using='[PL].[sum:amount:qk]' />",
    );
    expect(appliedXml(applyWorkbookDocument)).not.toContain('display_order');
  });

  it('adds waterfall anchor guidance when a category-like string dimension is unbound', async () => {
    const { getExecutor } = setupAutoApplyMocks({
      bind: boundWaterfallResult,
      inject: { ok: true, xml: INJECTED_WATERFALL_WORKBOOK_XML },
      workbookReads: [P_AND_L_WORKBOOK_XML],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'P&L waterfall',
      auto_apply: true,
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.guidance).toContain('schema has category');
    expect(body.guidance).toContain('proposal.bindings');
    expect(body.guidance).toContain('{slot_id:"anchor_category",field:"category"}');
    // Imperative, evidence-grounded wording — not an advisory the singer can hedge on.
    expect(body.guidance).toContain('double-count');
    expect(body.guidance).toContain('do NOT ask the user');
  });

  it('does not add waterfall anchor guidance when anchor_category is already bound', async () => {
    const { getExecutor } = setupAutoApplyMocks({
      bind: boundWaterfallWithAnchorResult,
      inject: { ok: true, xml: INJECTED_WATERFALL_WORKBOOK_XML },
      workbookReads: [P_AND_L_WORKBOOK_XML],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'P&L waterfall',
      auto_apply: true,
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.guidance).not.toContain('anchor_category');
  });

  it('does not add waterfall anchor guidance without a category-like string dimension', async () => {
    const { getExecutor } = setupAutoApplyMocks({
      bind: boundWaterfallResult,
      inject: { ok: true, xml: INJECTED_WATERFALL_WORKBOOK_XML },
      workbookReads: [P_AND_L_WORKBOOK_XML_WITHOUT_CATEGORY],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'P&L waterfall',
      auto_apply: true,
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.guidance).not.toContain('anchor_category');
  });

  it('adds waterfall default sort guidance only when sort is absent', async () => {
    const withoutSort = setupAutoApplyMocks({
      bind: boundWaterfallResult,
      inject: { ok: true, xml: INJECTED_WATERFALL_WORKBOOK_XML },
      workbookReads: [P_AND_L_WORKBOOK_XML],
    });

    const withoutSortResult = await getToolResult({
      session: '1',
      ask: 'P&L waterfall',
      auto_apply: true,
      getExecutor: withoutSort.getExecutor,
    });

    invariant(withoutSortResult.content[0].type === 'text');
    const withoutSortBody = JSON.parse(withoutSortResult.content[0].text);
    // Fixture has display_order → the specific, field-named order hint fires (routes to the bind).
    expect(withoutSortBody.guidance).toContain('Waterfall step order: schema has display_order');
    expect(withoutSortBody.guidance).toContain(
      'proposal.sort:{by:"display_order",direction:"asc"}',
    );

    vi.clearAllMocks();
    const withSort = setupAutoApplyMocks({
      bind: boundWaterfallWithSortResult,
      inject: { ok: true, xml: INJECTED_WATERFALL_WORKBOOK_XML },
      workbookReads: [P_AND_L_WORKBOOK_XML],
    });

    const withSortResult = await getToolResult({
      session: '1',
      ask: 'P&L waterfall',
      auto_apply: true,
      getExecutor: withSort.getExecutor,
    });

    invariant(withSortResult.content[0].type === 'text');
    const withSortBody = JSON.parse(withSortResult.content[0].text);
    expect(withSortBody.guidance).not.toContain(
      'Waterfall default sort is DESC by the bound measure',
    );
  });

  it('does not add waterfall guidance for non-waterfall templates', async () => {
    const { getExecutor } = setupAutoApplyMocks();

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.guidance).not.toContain('anchor_category');
    expect(body.guidance).not.toContain('Waterfall default sort');
  });

  it('applied waterfall with an unfilled order slot still steers a re-bind and is NOT terminal', async () => {
    // WATERFALL GUARD (non-negotiable): the m1 demo. A genuine unfilled sequence slot MUST
    // still emit the imperative re-bind steer and MUST NOT carry the terminal marker. A naive
    // blanket-terminate of every applied:true fails this test.
    const { getExecutor } = setupAutoApplyMocks({
      bind: boundWaterfallResult,
      inject: { ok: true, xml: INJECTED_WATERFALL_WORKBOOK_XML },
      workbookReads: [P_AND_L_WORKBOOK_XML],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'P&L waterfall',
      auto_apply: true,
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.guidance).toContain('Waterfall step order: schema has display_order');
    expect(body.guidance).toContain('proposal.sort:{by:"display_order",direction:"asc"}');
    expect(body.guidance).not.toContain('no further tool calls');
    expect(result.structuredContent).toBeUndefined();
  });

  it('keeps waterfall propose guidance exclusive to the structured Call-2 contract', async () => {
    const { getExecutor } = setupAutoApplyMocks({
      bind: waterfallProposeResult,
      workbookReads: [P_AND_L_WORKBOOK_XML],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'P&L waterfall',
      auto_apply: true,
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.status).toBe('propose');
    const anchorSlot = body.call_2_contract.proposal_choices[0].slots.find(
      (slot: { slot_id: string }) => slot.slot_id === 'anchor_category',
    );
    expect(anchorSlot.compatible_field_names).toEqual(['line_item', 'category']);
    expect(anchorSlot).not.toHaveProperty('field');
    expect(body.guidance).not.toContain('Waterfall step order');
    expect(body.guidance).not.toContain('refine-worksheet');
  });

  it('does not append fallback sort guidance to a propose result', async () => {
    const { getExecutor } = setupAutoApplyMocks({
      bind: waterfallProposeResult,
      workbookReads: [P_AND_L_WORKBOOK_XML_WITHOUT_DISPLAY_ORDER],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'P&L waterfall',
      auto_apply: true,
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.guidance).toContain('Call 2');
    expect(body.guidance).not.toContain('proposal.sort:{by:<field>');
    expect(body.guidance).not.toContain('Waterfall step order: schema has');
  });

  it('auto_apply=true replaces the waterfall built-in sort with a resolvable sort proposal', async () => {
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      bind: boundWaterfallWithSortResult,
      inject: { ok: true, xml: INJECTED_WATERFALL_WORKBOOK_XML },
      workbookReads: [P_AND_L_WORKBOOK_XML],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'P&L waterfall in display_order',
      proposal: {
        ...sampleProposal,
        sort: { by: 'display_order', direction: 'asc' },
      },
      auto_apply: true,
      getExecutor,
    });

    const xml = appliedXml(applyWorkbookDocument);
    expect(result.isError).toBe(false);
    expect(xml).toContain(
      "<column datatype='integer' name='[display_order]' role='measure' type='quantitative' />",
    );
    expect(xml).toContain(
      "<column-instance column='[display_order]' derivation='Sum' name='[sum:display_order:qk]' pivot='key' type='quantitative' />",
    );
    expect(xml).toContain(
      "<computed-sort column='[PL].[none:line_item:nk]' direction='ASC' using='[PL].[sum:display_order:qk]' />",
    );
    expect(xml).not.toContain("direction='DESC' using='[PL].[sum:amount:qk]'");
  });

  it('auto_apply=true replaces the real injected waterfall computed-sort pair with a resolvable sort proposal', async () => {
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      bind: boundWaterfallWithSortResult,
      inject: { ok: true, xml: REAL_INJECTED_WATERFALL_SORT_SHAPE_XML },
      workbookReads: [P_AND_L_WORKBOOK_XML],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'P&L waterfall in display_order',
      proposal: {
        ...sampleProposal,
        sort: { by: 'display_order', direction: 'asc' },
      },
      auto_apply: true,
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    const xml = appliedXml(applyWorkbookDocument);
    expect(result.isError).toBe(false);
    expect(body.warnings).toBeUndefined();
    expect(xml).toContain(
      "<computed-sort column='[PL].[none:line_item:nk]' direction='ASC' using='[PL].[sum:display_order:qk]' />",
    );
    expect(xml).not.toContain('using="[PL].[sum:amount:qk]"></computed-sort>');
  });

  it('auto_apply=true keeps the waterfall built-in sort and warns when sort field is unresolvable', async () => {
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      bind: boundWaterfallWithSortResult,
      inject: { ok: true, xml: INJECTED_WATERFALL_WORKBOOK_XML },
      workbookReads: [P_AND_L_WORKBOOK_XML_WITHOUT_DISPLAY_ORDER],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'P&L waterfall in display_order',
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.warnings?.join(' ')).toContain('sort splice skipped');
    expect(appliedXml(applyWorkbookDocument)).toContain(
      "<computed-sort column='[PL].[none:line_item:nk]' direction='DESC' using='[PL].[sum:amount:qk]' />",
    );
  });

  it('auto_apply=true splices proposal top_n into the applied workbook XML', async () => {
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      bind: boundWithTopNResult,
      inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML },
    });

    const result = await getToolResult({
      session: '1',
      ask: 'top 10 regions by sales',
      proposal: { ...sampleProposal, top_n: 10 },
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    expect(appliedXml(applyWorkbookDocument)).toMatch(/function='end'\s+end='top'\s+count='10'/);
    expect(appliedXml(applyWorkbookDocument)).toContain(
      '<slices><column>[Superstore].[none:Region:nk]</column></slices>',
    );
  });

  it('auto_apply=true splices proposal sort and top_n together in one apply', async () => {
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      bind: boundWithSortAndTopNResult,
      inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML },
    });

    const result = await getToolResult({
      session: '1',
      ask: 'top 10 regions by sales sorted descending',
      proposal: { ...sampleProposal, sort: { by: 'Sales', direction: 'desc' }, top_n: 10 },
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
    const xml = appliedXml(applyWorkbookDocument);
    expect(xml).toContain(
      "<computed-sort column='[Superstore].[none:Region:nk]' direction='DESC' using='[Superstore].[sum:Sales:qk]' />",
    );
    expect(xml).toMatch(/function='end'\s+end='top'\s+count='10'/);
  });

  it('m7: splices a context Region filter AFTER top_n, declares its CI, adds it to <slices>, and shows a filter card', async () => {
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      bind: boundM7TopNContextFilterResult,
      inject: { ok: true, xml: INJECTED_M7_RANKING_XML },
      workbookReads: [M7_WORKBOOK_XML],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'Show me the top 10 products by sales, and let me filter down to one region.',
      proposal: {
        ...sampleProposal,
        top_n: 10,
        filters: [{ field: 'Region', context: true }],
      },
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    const xml = appliedXml(applyWorkbookDocument);

    // (a) context='true' on the Region filter, enumerate-all interactive control (no member list).
    expect(xml).toContain(
      "<filter class='categorical' column='[M7].[none:region:nk]' context='true'>",
    );
    expect(xml).toMatch(
      /<filter class='categorical' column='\[M7\]\.\[none:region:nk\]' context='true'><groupfilter function='level-members' level='\[none:region:nk\]' user:ui-enumeration='all' \/><\/filter>/,
    );

    // (b) the Region CI declared in <datasource-dependencies> (column + column-instance).
    expect(xml).toContain(
      "<column datatype='string' name='[region]' role='dimension' type='nominal' />",
    );
    expect(xml).toContain(
      "<column-instance column='[region]' derivation='None' name='[none:region:nk]' pivot='key' type='nominal' />",
    );
    // ... and added to <slices> alongside the top-N product CI.
    expect(xml).toContain('<column>[M7].[none:region:nk]</column>');

    // (c) the shown <card type='filter'> in the sheet's window (filter_action_wired gate).
    expect(xml).toContain("<card mode='dropdown' param='[M7].[none:region:nk]' type='filter' />");

    // (d) planTopN still emits the top-N groupfilter on PRODUCT, unaffected by the region CI
    // (splice-after means planTopN never saw a second dimension → no ambiguity refusal).
    expect(xml).toMatch(/function='end'\s+end='top'\s+count='10'/);
    expect(xml).toContain("<filter class='categorical' column='[M7].[none:product:nk]'>");
  });

  it('m7: a context filter with explicit member values emits an inclusive member union', async () => {
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      bind: {
        ...boundM7TopNContextFilterResult,
        args: {
          ...boundM7TopNContextFilterResult.args,
          filters: [{ field: 'Region', values: ['East'], context: true }],
        },
      } as BinderResult,
      inject: { ok: true, xml: INJECTED_M7_RANKING_XML },
      workbookReads: [M7_WORKBOOK_XML],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'top 10 products by sales in the East region',
      proposal: {
        ...sampleProposal,
        top_n: 10,
        filters: [{ field: 'Region', values: ['East'], context: true }],
      },
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    const xml = appliedXml(applyWorkbookDocument);
    expect(xml).toContain(
      "<filter class='categorical' column='[M7].[none:region:nk]' context='true'>",
    );
    expect(xml).toContain(
      "<groupfilter function='member' level='[none:region:nk]' member='East' user:ui-enumeration='inclusive' user:ui-marker='enumerate' />",
    );
    // top-N unaffected.
    expect(xml).toMatch(/function='end'\s+end='top'\s+count='10'/);
  });

  it('bad sort.by escalation never reaches auto-apply', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks({
      bind: badSortFieldEscalateResult,
    });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart sorted by definitely not a field',
      proposal: {
        ...sampleProposal,
        sort: { by: 'Definitely Not A Field', direction: 'desc' },
      },
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.status).toBe('escalate');
    expect(body.blockers[0].detail).toContain('Definitely Not A Field');
    expect(buildInjectedWorkbookXml).not.toHaveBeenCalled();
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('authors inline calcs before binding and auto-applies against the readback workbook', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const { applyWorkbookDocument, getEvents, getExecutor } = setupAutoApplyMocks({
      workbookReads: [CALC_BASE_XML, CALC_READBACK_XML],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Margin by Region',
      calcs: [{ caption: 'Margin', formula: '[Sales] * 0.2' }],
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(true);
    expect(body.authored_calcs).toEqual(['Margin']);
    expect(body.guidance).toContain('Calcs authored: Margin');
    expect(binderModule.bindTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ workbookXml: CALC_READBACK_XML }),
    );
    expect(buildInjectedWorkbookXml).toHaveBeenCalledWith(
      expect.objectContaining({ workbookXml: CALC_READBACK_XML }),
    );
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(2);
    expect(getEvents).toHaveBeenCalledTimes(3);
    expect(getEvents).toHaveBeenNthCalledWith(2, {
      signal: expect.any(AbortSignal),
      sinceSequence: 41,
    });
    expect(getEvents).toHaveBeenNthCalledWith(3, {
      signal: expect.any(AbortSignal),
    });
  });

  it('resolves loose calc references and percent-formats a ratio in the same bind call', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const baseXml = CALC_BASE_XML.replace(
      "<column caption='Sales' datatype='real' name='[Sales]' role='measure' type='quantitative' />",
      [
        "<column caption='Sales' datatype='real' name='[sales_amount]' role='measure' type='quantitative' />",
        "<column caption='Gross Profit' datatype='real' name='[gross_profit]' role='measure' type='quantitative' />",
      ].join(''),
    );
    const calcXml =
      "<column caption='Gross Margin %' datatype='real' default-format='p0%' name='[Calculation_1700000000000]' role='measure' type='quantitative'><calculation class='tableau' formula='SUM([gross_profit]) / SUM([sales_amount])' /></column>";
    const readbackXml = baseXml.replace('</datasource>', `${calcXml}</datasource>`);
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      workbookReads: [baseXml, readbackXml],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'Show me gross margin %.',
      calcs: [
        {
          caption: 'Gross Margin %',
          formula: 'SUM([gross profit]) / SUM([Sales])',
        },
      ],
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(2);
    expect(applyWorkbookDocument.mock.calls[0]?.[0]).toContain(calcXml);
    expect(binderModule.bindTemplate).toHaveBeenCalledTimes(1);
    expect(binderModule.bindTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ workbookXml: readbackXml }),
    );
  });

  it('rejects an ambiguous loose calc reference with at most three candidates', async () => {
    const baseXml = CALC_BASE_XML.replace(
      '</datasource>',
      [
        "<column caption='Profit' datatype='real' name='[Profit]' role='measure' type='quantitative' />",
        "<column caption='Amount' datatype='real' name='[Amount]' role='measure' type='quantitative' />",
        "<column caption='Revenue Amount' datatype='real' name='[Revenue Amount]' role='measure' type='quantitative' />",
        "<column caption='Net Sales' datatype='real' name='[Net Sales]' role='measure' type='quantitative' />",
        '</datasource>',
      ].join(''),
    );
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      workbookReads: [baseXml],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'Show me gross margin %.',
      calcs: [{ caption: 'Gross Margin %', formula: '[Profit] / [Revenue]' }],
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      'field reference [Revenue] is ambiguous <one of: Sales, Amount, Revenue Amount>',
    );
    expect(result.content[0].text).not.toContain('Net Sales');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
    expect(binderModule.bindTemplate).not.toHaveBeenCalled();
  });

  it('keeps bracketed text inside quoted calc string literals untouched', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const formula = 'IF \'[Revenue]\' = "[Revenue]" THEN [Sales] END';
    const calcXml =
      "<column caption='Literal Brackets' datatype='real' name='[Calculation_1700000000000]' role='measure' type='quantitative'><calculation class='tableau' formula='IF &apos;[Revenue]&apos; = &quot;[Revenue]&quot; THEN [Sales] END' /></column>";
    const readbackXml = CALC_BASE_XML.replace('</datasource>', `${calcXml}</datasource>`);
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      workbookReads: [CALC_BASE_XML, readbackXml],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Literal Brackets',
      calcs: [{ caption: 'Literal Brackets', formula }],
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    expect(applyWorkbookDocument.mock.calls[0]?.[0]).toContain(calcXml);
  });

  it('resolves a loose calc field reference containing an escaped closing bracket', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const baseXml = CALC_BASE_XML.replace(
      "<column caption='Sales' datatype='real' name='[Sales]' role='measure' type='quantitative' />",
      "<column caption='Rate] Value' datatype='real' name='[rate_value]' role='measure' type='quantitative' />",
    );
    const calcXml =
      "<column caption='Escaped Bracket Calc' datatype='real' name='[Calculation_1700000000000]' role='measure' type='quantitative'><calculation class='tableau' formula='SUM([rate_value])' /></column>";
    const readbackXml = baseXml.replace('</datasource>', `${calcXml}</datasource>`);
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      workbookReads: [baseXml, readbackXml],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Escaped Bracket Calc',
      calcs: [{ caption: 'Escaped Bracket Calc', formula: 'SUM([Rate]] Value])' }],
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    expect(applyWorkbookDocument.mock.calls[0]?.[0]).toContain(calcXml);
    expect(applyWorkbookDocument.mock.calls[0]?.[0]).not.toContain('SUM([Rate]');
  });

  it('percent-formats only dividing calcs whose own caption is percent-like', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const percentCalcXml =
      "<column caption='Return %' datatype='real' default-format='p0%' name='[Calculation_1700000000000]' role='measure' type='quantitative'><calculation class='tableau' formula='[Sales] / 100' /></column>";
    const averageCalcXml =
      "<column caption='Average Order Value' datatype='real' name='[Calculation_1700000000001]' role='measure' type='quantitative'><calculation class='tableau' formula='[Sales] / 2' /></column>";
    const readbackXml = CALC_BASE_XML.replace(
      '</datasource>',
      `${percentCalcXml}${averageCalcXml}</datasource>`,
    );
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      workbookReads: [CALC_BASE_XML, readbackXml],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'return % and average order value',
      calcs: [
        { caption: 'Return %', formula: '[Sales] / 100' },
        { caption: 'Average Order Value', formula: '[Sales] / 2' },
      ],
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    expect(applyWorkbookDocument.mock.calls[0]?.[0]).toContain(percentCalcXml);
    expect(applyWorkbookDocument.mock.calls[0]?.[0]).toContain(averageCalcXml);
  });

  it('rejects invalid inline calcs before any document load or bind', async () => {
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      workbookReads: [CALC_BASE_XML],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Margin by Region',
      calcs: [{ caption: 'Margin', formula: '   ' }],
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('calc "Margin": formula empty');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
    expect(binderModule.bindTemplate).not.toHaveBeenCalled();
    expect(buildInjectedWorkbookXml).not.toHaveBeenCalled();
  });

  it('auto_apply=true leaves a contested-revenue ranking proposal unchanged', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks({
      bind: contestedRevenueProposeResult,
    });

    const result = await getToolResult({
      session: '1',
      ask: 'Show me our top customers.',
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.status).toBe('propose');
    expect(body.applied).toBeUndefined();
    expect(body.llm_input).not.toHaveProperty('recommended');
    expect(binderModule.bindTemplate).toHaveBeenCalledTimes(1);
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('auto_apply=true leaves a non-ranking proposal unchanged', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks({ bind: proposeResult });

    const result = await getToolResult({
      session: '1',
      ask: 'something weird',
      auto_apply: true,
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.status).toBe('propose');
    expect(body.applied).toBeUndefined();
    expect(binderModule.bindTemplate).toHaveBeenCalledTimes(1);
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('reports authored calcs when the subsequent bind proposes', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      bind: proposeResult,
      workbookReads: [CALC_BASE_XML, CALC_READBACK_XML],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'something weird with Margin',
      calcs: [{ caption: 'Margin', formula: '[Sales] * 0.2' }],
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.status).toBe('propose');
    expect(body.authored_calcs).toEqual(['Margin']);
    expect(body.guidance).toContain('Calcs authored: Margin. Bind outcome: propose.');
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
    expect(buildInjectedWorkbookXml).not.toHaveBeenCalled();
  });

  it('auto_apply=true leaves an escalate outcome unchanged (no apply)', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks({ bind: escalateResult });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Revenue by Region',
      proposal: sampleProposal,
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.status).toBe('escalate');
    expect(body.applied).toBeUndefined();
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('auto_apply=true does NOT apply when the chosen manifest is not fast_path_eligible', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks({ fastPathEligible: false });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBeUndefined();
    expect(buildInjectedWorkbookXml).not.toHaveBeenCalled();
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('runs preflight validation BEFORE dispatching the apply (validated path)', async () => {
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks();

    await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });

    expect(validationRegistry.runValidation).toHaveBeenCalledTimes(1);
    expect(validationRegistry.runValidation).toHaveBeenCalledWith('<workbook/>', 'workbook');
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
    const validationOrder = vi.mocked(validationRegistry.runValidation).mock.invocationCallOrder[0];
    const dispatchOrder = applyWorkbookDocument.mock.invocationCallOrder[0];
    expect(validationOrder).toBeLessThan(dispatchOrder);
  });

  it('Miller World Cup repro: auto_apply ignores telemetry-only Parameter 1/Parameter 2 findings', async () => {
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks();
    vi.mocked(validationRegistry.runValidation).mockReturnValue({
      valid: false,
      issues: [
        {
          ruleId: 'calc-field-names',
          severity: 'warning',
          message:
            'Non-standard internal name detected (telemetry only): [Parameter 1]. If this field works correctly in Tableau, this warning can be ignored.',
        },
        {
          ruleId: 'calc-field-names',
          severity: 'warning',
          message:
            'Non-standard internal name detected (telemetry only): [Parameter 2]. If this field works correctly in Tableau, this warning can be ignored.',
        },
      ],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'Bar chart of countries by Points, sorted descending',
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(true);
    expect(body.guidance).not.toContain('preflight validation failed');
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
  });
});

describe('bindTemplateTool auto_apply graceful fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(externalDiscovery.discoverInstances).mockReturnValue([]);
  });

  it('inject failure returns the bound args intact with applied:false + apply_error', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks({
      inject: { ok: false, issues: ['not well-formed'] },
    });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(false);
    expect(body.apply_error).toContain('inject failed');
    expect(body.apply_error).toContain('not well-formed');
    // The bind is never lost — args are intact for the visible build-and-apply fallback
    // and, where available, the template chain.
    expect(body.args).toEqual(boundResult.status === 'bound' ? boundResult.args : undefined);
    // P1-5 contrast: inject/validation/apply failures did NOT stem from a stale
    // workbook, so the "fall back using the returned args" guidance
    // is correct here and must be retained (only the events-dirty branch drops it).
    expect(String(body.guidance)).toContain(
      'fall back to build-and-apply-worksheet using the returned args',
    );
    expect(String(body.guidance)).toContain('the template chain');
    // Apply is not attempted once inject fails.
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('apply failure returns the bound args intact with applied:false + apply_error', async () => {
    const { getExecutor } = setupAutoApplyMocks({
      dispatch: Err({ type: 'command-timed-out', error: 'Timeout' }),
    });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(false);
    expect(body.apply_error).toContain('apply failed');
    expect(body.args).toEqual(boundResult.status === 'bound' ? boundResult.args : undefined);
  });

  it('preflight validation failure aborts the apply and falls back (no dispatch)', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks({ validationValid: false });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(false);
    expect(body.apply_error).toContain('preflight validation failed');
    // Preflight gates the dispatch — the invalid XML is never sent.
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('admits one same-signature retry after a pre-dispatch apply failure', async () => {
    const { getExecutor } = setupAutoApplyMocks({ bind: boundViaProposalResult });
    vi.mocked(binderModule.bindTemplate)
      .mockResolvedValueOnce(proposeResult)
      .mockResolvedValueOnce(boundViaProposalResult)
      .mockResolvedValueOnce(boundViaProposalResult);
    vi.mocked(buildInjectedWorkbookXml)
      .mockReturnValueOnce({ ok: false, issues: ['broken fragment'] })
      .mockReturnValueOnce({ ok: false, issues: ['still broken'] });
    const ask = 'bar chart of Revenue by Region';

    await getToolResult({ session: '1', ask, auto_apply: true, getExecutor });
    const failed = await getToolResult({
      session: '1',
      ask,
      proposal: sampleProposal,
      auto_apply: true,
      getExecutor,
    });
    const admittedRetry = await getToolResult({
      session: '1',
      ask,
      proposal: sampleProposalTitleOnlyChange,
      auto_apply: true,
      getExecutor,
    });
    const blockedRepeat = await getToolResult({
      session: '1',
      ask,
      proposal: sampleProposal,
      auto_apply: true,
      getExecutor,
    });

    expect(failed.isError).toBe(true);
    expect(admittedRetry.isError).toBe(true);
    invariant(admittedRetry.content[0].type === 'text');
    expect(JSON.parse(admittedRetry.content[0].text).apply_error).toContain('still broken');
    invariant(blockedRepeat.content[0].type === 'text');
    expect(JSON.parse(blockedRepeat.content[0].text)).toMatchObject({
      status: 'blocked',
      reason: 'unchanged_proposal',
    });
    // 5 = the three user-visible calls plus one context-measure dry re-classify
    // per bound Call-2 proposal (both dries no-op: the base mock is already bound).
    expect(binderModule.bindTemplate).toHaveBeenCalledTimes(5);
    expect(buildInjectedWorkbookXml).toHaveBeenCalledTimes(2);
  });

  it('does not admit a same-signature retry after post-dispatch timeout', async () => {
    const { getExecutor } = setupAutoApplyMocks({
      bind: boundViaProposalResult,
      dispatch: Err({ type: 'command-timed-out', error: 'Timeout' }),
    });
    vi.mocked(binderModule.bindTemplate)
      .mockResolvedValueOnce(proposeResult)
      .mockResolvedValueOnce(boundViaProposalResult);
    const ask = 'bar chart of Revenue by Region';

    await getToolResult({ session: '1', ask, auto_apply: true, getExecutor });
    const failed = await getToolResult({
      session: '1',
      ask,
      proposal: sampleProposal,
      auto_apply: true,
      getExecutor,
    });
    const blockedRetry = await getToolResult({
      session: '1',
      ask,
      proposal: sampleProposalTitleOnlyChange,
      auto_apply: true,
      getExecutor,
    });

    expect(failed.isError).toBe(true);
    invariant(blockedRetry.content[0].type === 'text');
    expect(JSON.parse(blockedRetry.content[0].text)).toMatchObject({
      status: 'blocked',
      reason: 'unchanged_proposal',
    });
    // 3 = two user-visible calls plus the context-measure dry re-classify on the
    // bound Call-2 proposal (no-op: the base mock is already bound).
    expect(binderModule.bindTemplate).toHaveBeenCalledTimes(3);
  });
});

describe('bindTemplateTool session-default-when-unique', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(externalDiscovery.discoverInstances).mockReturnValue([]);
  });

  function mockInstances(pids: number[]): void {
    vi.mocked(externalDiscovery.discoverInstances).mockReturnValue(
      pids.map(
        (pid) => ({ pid }) as ReturnType<typeof externalDiscovery.discoverInstances>[number],
      ),
    );
  }

  it('resolves the session automatically when exactly one Desktop instance is running', async () => {
    mockInstances([4242]);
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(boundResult);
    const getExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({ ask: 'bar chart of Sales by Region', getExecutor });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text).status).toBe('bound');
    // The single instance's pid becomes the resolved session.
    expect(getExecutor).toHaveBeenCalledWith('4242');
  });

  it('fails closed listing instances when 2+ Desktop instances are running', async () => {
    mockInstances([11, 22]);
    const getExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({ ask: 'bar chart of Sales by Region', getExecutor });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Multiple Tableau Desktop instances are running');
    expect(result.content[0].text).toContain('11, 22');
    // Fail closed: never guess, never touch the workbook.
    expect(getExecutor).not.toHaveBeenCalled();
    expect(binderModule.bindTemplate).not.toHaveBeenCalled();
  });

  it('fails closed when no Desktop instance is running', async () => {
    mockInstances([]);
    const getExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({ ask: 'bar chart of Sales by Region', getExecutor });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new NoDesktopInstancesFoundError().message);
    expect(getExecutor).not.toHaveBeenCalled();
    expect(binderModule.bindTemplate).not.toHaveBeenCalled();
  });

  it('targets an explicit session that is one of the running instances', async () => {
    mockInstances([11, 22]);
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(boundResult);
    const getExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '22',
      ask: 'bar chart of Sales by Region',
      getExecutor,
    });

    expect(result.isError).toBe(false);
    expect(getExecutor).toHaveBeenCalledWith('22');
  });

  it('rejects an explicit session that is not a running instance, naming the running pids', async () => {
    mockInstances([11, 22]);
    const getExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '7',
      ask: 'bar chart of Sales by Region',
      getExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('7');
    expect(result.content[0].text).toContain('list-instances');
    expect(getExecutor).not.toHaveBeenCalled();
    expect(binderModule.bindTemplate).not.toHaveBeenCalled();
  });
});

describe('bindTemplateTool auto_apply target_worksheet (e1/s7 stray-sheet class)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(externalDiscovery.discoverInstances).mockReturnValue([]);
  });

  it('applies onto the named existing sheet and navigates to it', async () => {
    const targetWorkbookXml = INJECTED_WORKBOOK_WITH_NEW_SHEET_WINDOW.replace(
      /Sales by Region/g,
      'se-eval-scratch',
    );
    const { executeCommand, applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      inject: { ok: true, xml: targetWorkbookXml },
    });
    vi.mocked(classifyWorksheetReplaceTarget).mockReturnValue('replaceable');

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      target_worksheet: 'se-eval-scratch',
      getExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(true);
    expect(body.sheet_name).toBe('se-eval-scratch');
    expect(vi.mocked(buildInjectedWorkbookXml)).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'se-eval-scratch' }),
    );
    expect(vi.mocked(classifyWorksheetReplaceTarget)).toHaveBeenCalledWith(XML, 'se-eval-scratch');
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
    // Naming a target sheet used to suppress navigation. It no longer does: the apply posts
    // the whole document, which moves the view on its own, so the sheet the call rewrote is
    // the sheet the user must land on.
    expect(executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'tabdoc',
        command: 'goto-sheet',
        args: { Sheet: 'se-eval-scratch' },
      }),
    );
  });

  it('unknown target fails closed BEFORE the bind even runs', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks();
    vi.mocked(classifyWorksheetReplaceTarget).mockReturnValue('not-found');

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      target_worksheet: 'No Such Sheet',
      getExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('target_worksheet "No Such Sheet" not found');
    expect(result.content[0].text).toContain('list-worksheets');
    expect(vi.mocked(binderModule.bindTemplate)).not.toHaveBeenCalled();
    expect(vi.mocked(buildInjectedWorkbookXml)).not.toHaveBeenCalled();
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('dashboard-member target is refused: in-place replace would corrupt the dashboard', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks();
    vi.mocked(classifyWorksheetReplaceTarget).mockReturnValue('in-dashboard');

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      target_worksheet: 'Dash Member',
      getExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('dashboard member sheet');
    expect(vi.mocked(binderModule.bindTemplate)).not.toHaveBeenCalled();
    expect(vi.mocked(buildInjectedWorkbookXml)).not.toHaveBeenCalled();
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('manual mode (no auto_apply): bound args echo carries the target title so the manual chain lands on it', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(boundResult);
    vi.mocked(classifyWorksheetReplaceTarget).mockReturnValue('replaceable');

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      target_worksheet: 'se-eval-scratch',
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.status).toBe('bound');
    expect(body.args.title).toBe('se-eval-scratch');
  });

  it('no target_worksheet: behavior unchanged, inject titled from the bound args', async () => {
    const { getExecutor } = setupAutoApplyMocks();

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(true);
    expect(body.sheet_name).toBe('Sales by Region');
    expect(vi.mocked(classifyWorksheetReplaceTarget)).not.toHaveBeenCalled();
  });
});

describe('bindTemplateTool auto_apply — events-clean gate (W60 blind-spot #1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(externalDiscovery.discoverInstances).mockReturnValue([]);
  });

  it('refuses to auto-apply over a workbook the user touched mid-bind (falls back, bind intact)', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks({ userEventsDuringBind: 3 });
    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(body.applied).toBe(false);
    expect(String(body.apply_error)).toMatch(/user changed the workbook.*3 event/);
    expect(body.args).toBeDefined(); // the bind survives — agent can re-get and retry
    expect(executeCommand).not.toHaveBeenCalled(); // the apply dispatch was suppressed
  });

  it('anchors the events sequence BEFORE reading the workbook (P1 race fix)', async () => {
    // The self-review / adversary P1-4 finding: with the anchor captured AFTER the read,
    // a user edit landing in the (read, anchor] window gets sequence <= anchor and is
    // excluded by the strict `since` filter → silently reverted by the whole-document
    // apply. Pin the real call order (not independent mocks): the anchor getEvents must
    // fire before getWorkbookXml.
    const { getEvents, getExecutor } = setupAutoApplyMocks({ userEventsDuringBind: 0 });
    await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });

    const anchorOrder = getEvents.mock.invocationCallOrder[0];
    const readOrder = vi.mocked(getWorkbookXmlModule.getWorkbookXml).mock.invocationCallOrder[0];
    expect(anchorOrder).toBeLessThan(readOrder);
  });

  it('refuses without inviting a manual re-apply of the stale pre-edit args (P1-5)', async () => {
    // events-dirty branch: the returned args were computed against the pre-edit
    // workbook. Guidance must NOT offer "apply the returned args manually" — that would
    // reopen the exact race the gate just avoided. Re-running bind-template (fresh read)
    // is the only safe option here.
    const { getExecutor } = setupAutoApplyMocks({ userEventsDuringBind: 2 });
    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(body.applied).toBe(false);
    expect(String(body.apply_error)).not.toMatch(/apply the returned args manually/i);
    expect(String(body.guidance)).not.toMatch(/using the returned args/i);
    expect(String(body.guidance)).toMatch(/re-run bind-template/i);
    // The bind still survives so the agent can re-get and retry deliberately.
    expect(body.args).toBeDefined();
  });

  it('applies when the workbook is events-clean (0 user events since the read)', async () => {
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({ userEventsDuringBind: 0 });
    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(body.applied).toBe(true);
    expect(applyWorkbookDocument).toHaveBeenCalled();
  });

  it('gate is best-effort: an executor without event support still auto-applies (Athena residual)', async () => {
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      userEventsDuringBind: 'unsupported',
    });
    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(body.applied).toBe(true);
    expect(applyWorkbookDocument).toHaveBeenCalled();
  });
});

describe('bindTemplateTool route-state recording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(externalDiscovery.discoverInstances).mockReturnValue([]);
    sessionRouteState.clear();
    vi.spyOn(bundledIntelligenceProvider, 'listTemplateManifests').mockReturnValue([
      ...loadManifests().values(),
    ]);
  });

  it('records classification and final bind outcome with ROUTE_ENFORCEMENT unset', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(boundResult);

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: false,
    });

    expect(result.isError).toBe(false);
    const state = sessionRouteState.get('1');
    expect(state?.current_ask).toMatchObject({
      ask: normalizeAskForMatch('bar chart of Sales by Region'),
      route: 'bind-first',
      shape: 'bind-first-template',
      template: 'ranking-ordered-bar',
      last_outcome: 'bound',
    });
    expect(typeof state?.current_ask?.ts).toBe('string');
  });

  it('does not leak route-state recording into the returned CallToolResult', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks();

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: false,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body).toEqual({
      ...boundResult,
      guidance: boundResult.status === 'bound' ? boundResult.apply_instruction : '',
    });
    expect(body.current_ask).toBeUndefined();
    expect(body.next_route).toBeUndefined();
    expect(buildInjectedWorkbookXml).not.toHaveBeenCalled();
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('a THROWN bind clears the pending ask so the gate cannot read "no bind attempt yet"', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockRejectedValue(new Error('binder exploded'));

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: false,
    });

    // The error path is unchanged (the tool reports the failure)...
    expect(result.isError).toBe(true);
    // ...and the classification recorded BEFORE the throw is gone: a bind WAS attempted,
    // so a pending "no bind attempt yet" record would let the scratch gate deflect a
    // second time for an ask the agent already tried (review finding, 2026-07-11).
    expect(sessionRouteState.get('1')?.current_ask).toBeUndefined();
  });

  it('a classification fault on a NEW ask clears a stale pending ask (no cross-ask leak)', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(boundResult);

    // Seed pending ask A (never concluded).
    sessionRouteState.recordAskClassification('1', {
      ask: normalizeAskForMatch('ask A that is still pending'),
      route: 'bind-first',
      shape: 'bind-first-template',
      template: 'ranking-ordered-bar',
    });
    // Make classification throw for ask B (the route layer faulting mid-classification).
    vi.spyOn(routeSpecModule, 'classifyAskRoute').mockImplementation(() => {
      throw new TypeError('keywords is not iterable');
    });

    const result = await getToolResult({
      session: '1',
      ask: 'completely different ask B',
      auto_apply: false,
    });

    // Bind B still succeeds (fail-open)...
    expect(result.isError).toBe(false);
    // ...and pending ask A did NOT survive to mislead the scratch gate about ask B's turn.
    expect(sessionRouteState.get('1')?.current_ask).toBeUndefined();
  });
});

function appliedXml(applyWorkbookDocument: ReturnType<typeof vi.fn>): string {
  return appliedXmlAt(applyWorkbookDocument, 0);
}

function appliedXmlAt(applyWorkbookDocument: ReturnType<typeof vi.fn>, index: number): string {
  const [xml] = applyWorkbookDocument.mock.calls[index] ?? [];
  invariant(typeof xml === 'string');
  return xml;
}

// ── Duplicate-sheet reuse: the re-bind loop ───────────────────────────────────
// Measured on the full LangSmith census: 55.1% of production traces that call
// bind-template call it more than once, and across 105 consecutive pairs the target
// sheet differs in 3. The agent re-states ONE chart in new words rather than building
// different sheets — and because the binder titles a Call-1 sheet with the ask text
// itself, each rewording used to land as a duplicate sheet under a paraphrased name.
describe('bindTemplateTool duplicate-sheet reuse', () => {
  // Verbatim rewordings from eval trace 1010e827 (one MAU chart, six rewordings).
  const REWORDED_TITLES = [
    'line chart of monthly active users (mau) over the last 12 months, month on the x-axis',
    'line chart showing mau by month, one point per month value',
    'mau by month, ordered chronologically',
  ];

  function bindReturning(bind: BinderResult): void {
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(bind);
  }

  function retitled(title: string): BinderResult {
    invariant(boundResult.status === 'bound');
    return { ...boundResult, args: { ...boundResult.args, title } };
  }

  function body(result: CallToolResult): Record<string, unknown> {
    invariant(result.content[0].type === 'text');
    return JSON.parse(result.content[0].text);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(externalDiscovery.discoverInstances).mockReturnValue([]);
    vi.mocked(classifyWorksheetReplaceTarget).mockReturnValue('replaceable');
  });

  it('a repeated ask reuses the sheet, then its guided target rebuild applies', async () => {
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_WORKBOOK_WITH_NEW_SHEET_WINDOW },
    });
    const ask = 'bar chart of Sales by Region';

    const first = body(
      await getToolResult({
        session: '1',
        ask,
        auto_apply: true,
        getExecutor,
      }),
    );
    expect(first.applied).toBe(true);
    expect(first.sheet_name).toBe('Sales by Region');

    // The same ask is deduplicated and guides the caller to rebuild the remembered sheet.
    const secondResult = await getToolResult({
      session: '1',
      ask,
      auto_apply: true,
      getExecutor,
    });
    const second = body(secondResult);

    expect(second.reused).toBe(true);
    expect(second.applied).toBe(false);
    expect(second.sheet_name).toBe('Sales by Region');
    expect(second.guidance).toContain('still present by name');
    expect(second.guidance).toContain('target_worksheet');
    expect(second.guidance).not.toContain('no further tool calls needed');
    expect(
      (secondResult.structuredContent as { nextAction: { kind: string; label: string } })
        .nextAction,
    ).toMatchObject({ kind: 'prefill', label: expect.stringContaining('Rebuild') });

    const thirdResult = await getToolResult({
      session: '1',
      ask,
      auto_apply: true,
      target_worksheet: 'Sales by Region',
      getExecutor,
    });
    const third = body(thirdResult);

    expect(thirdResult.content[0]).not.toMatchObject({
      type: 'text',
      text: expect.stringContaining('Blocked:'),
    });
    expect(third.applied).toBe(true);
    expect(third.reused).toBeUndefined();
    expect(buildInjectedWorkbookXml).toHaveBeenCalledTimes(2);
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(2);
    expect(sessionRouteState.getBindRecovery('1', normalizeAskForMatch(ask))).toBeUndefined();
  });

  it('reuses when Desktop advances the event sequence during the remembered apply', async () => {
    const { applyWorkbookDocument, getEvents, getExecutor } = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_WORKBOOK_WITH_NEW_SHEET_WINDOW },
    });
    getEvents.mockImplementation(({ sinceSequence }: { sinceSequence?: number }) => {
      const latestSequence = applyWorkbookDocument.mock.calls.length === 0 ? 41 : 42;
      return Promise.resolve(
        Ok({
          events: [],
          latest_sequence: latestSequence,
          count: 0,
          ...(sinceSequence === undefined ? {} : { since_sequence: sinceSequence }),
        }),
      );
    });
    const ask = 'bar chart of Sales by Region';

    await getToolResult({ session: '1', ask, auto_apply: true, getExecutor });
    const second = body(await getToolResult({ session: '1', ask, auto_apply: true, getExecutor }));

    expect(second.reused).toBe(true);
    expect(second.applied).toBe(false);
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
    expect(getEvents).toHaveBeenNthCalledWith(3, { signal: expect.any(AbortSignal) });
  });

  it('rebuilds when the events anchor advanced after the remembered sheet was built', async () => {
    const userEditedWorkbook = INJECTED_RANKING_WORKBOOK_XML.replace(
      '<rows>[Superstore].[none:Region:nk]</rows>',
      '<rows>[Superstore].[none:Category:nk]</rows>',
    );
    const { applyWorkbookDocument, getEvents, getExecutor } = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML },
      workbookReads: [XML, userEditedWorkbook],
    });

    await getToolResult({
      session: '1',
      ask: REWORDED_TITLES[0],
      auto_apply: true,
      getExecutor,
    });
    expect(getEvents).toHaveBeenCalledTimes(3);

    getEvents.mockImplementation(({ sinceSequence }: { sinceSequence?: number }) =>
      sinceSequence === undefined
        ? Promise.resolve(
            Ok({
              events: [
                {
                  sequence: 42,
                  type: 'doc:field-added-event',
                  timestamp: '2026-07-25T12:00:00Z',
                },
              ],
              latest_sequence: 42,
              count: 1,
            }),
          )
        : Promise.resolve(Ok({ events: [], latest_sequence: 42, count: 0 })),
    );
    bindReturning(retitled(REWORDED_TITLES[1]));
    const second = body(
      await getToolResult({
        session: '1',
        ask: REWORDED_TITLES[1],
        auto_apply: true,
        getExecutor,
      }),
    );

    expect(second.reused).toBeUndefined();
    expect(second.applied).toBe(true);
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(2);
  });

  it('eventually blocks repeated bare same-ask calls after a reuse hit', async () => {
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_WORKBOOK_WITH_NEW_SHEET_WINDOW },
    });
    const ask = 'bar chart of Sales by Region';

    await getToolResult({ session: '1', ask, auto_apply: true, getExecutor });
    const reused = body(await getToolResult({ session: '1', ask, auto_apply: true, getExecutor }));
    const firstBareResubmit = body(
      await getToolResult({ session: '1', ask, auto_apply: true, getExecutor }),
    );
    const terminal = body(
      await getToolResult({ session: '1', ask, auto_apply: true, getExecutor }),
    );

    expect(reused.reused).toBe(true);
    expect(firstBareResubmit).toMatchObject({
      status: 'blocked',
      reason: 'awaiting_proposal',
    });
    expect(terminal).toMatchObject({
      status: 'blocked',
      reason: 'fallback_required',
    });
    expect(terminal.guidance).toContain('build-and-apply-worksheet');
    expect(sessionRouteState.getBindRecovery('1', normalizeAskForMatch(ask))).toMatchObject({
      phase: 'terminal',
      consecutiveBareResubmitCount: 2,
    });
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
    expect(binderModule.bindTemplate).toHaveBeenCalledTimes(2);
  });

  it('reports calc writes honestly when the sheet itself is reused', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_WORKBOOK_WITH_NEW_SHEET_WINDOW },
      workbookReads: [CALC_BASE_XML, CALC_BASE_XML, CALC_BASE_XML, CALC_READBACK_XML],
    });

    await getToolResult({
      session: '1',
      ask: REWORDED_TITLES[0],
      auto_apply: true,
      getExecutor,
    });
    bindReturning(retitled(REWORDED_TITLES[1]));
    const second = body(
      await getToolResult({
        session: '1',
        ask: REWORDED_TITLES[1],
        auto_apply: true,
        calcs: [{ caption: 'Margin', formula: '[Sales] * 0.2' }],
        getExecutor,
      }),
    );

    const reuseReceipt = second.receipt as {
      did: string[];
      didNot: string[];
      unverified: string[];
    };
    expect(second.reused).toBe(true);
    expect(second.applied).toBe(true);
    expect(second.authored_calcs).toEqual(['Margin']);
    expect(reuseReceipt.did).toContain('authored calcs: Margin');
    expect(reuseReceipt.didNot.join(' ')).not.toContain('nothing was applied on this call');
    // One sheet apply plus one calc-document write; no duplicate sheet apply.
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(2);
  });

  it('holds across a run of rewordings — the third and fourth restatement reuse too', async () => {
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_WORKBOOK_WITH_NEW_SHEET_WINDOW },
    });

    await getToolResult({ session: '1', ask: REWORDED_TITLES[0], auto_apply: true, getExecutor });
    for (const title of REWORDED_TITLES.slice(1)) {
      bindReturning(retitled(title));
      const result = body(
        await getToolResult({ session: '1', ask: title, auto_apply: true, getExecutor }),
      );
      expect(result.reused).toBe(true);
    }
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
  });

  it('a second bind for a DIFFERENT chart is not reused — it applies normally', async () => {
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_WORKBOOK_WITH_NEW_SHEET_WINDOW },
    });

    await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });

    invariant(boundResult.status === 'bound');
    bindReturning({
      ...boundResult,
      args: {
        ...boundResult.args,
        title: 'Profit by Category',
        field_mapping: { cat: '[Category]', val: '[Profit]' },
      },
    });
    const second = body(
      await getToolResult({
        session: '1',
        ask: 'bar chart of Profit by Category',
        auto_apply: true,
        getExecutor,
      }),
    );

    expect(second.reused).toBeUndefined();
    expect(second.applied).toBe(true);
    expect(second.sheet_name).toBe('Profit by Category');
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(2);
  });

  it('a real refinement of the same chart still applies — adding a sort is not a repeat', async () => {
    // The ranking fixture carries the rows/cols the sort and top-N splices need.
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML },
    });

    await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });

    bindReturning(boundWithSortResult);
    const second = body(
      await getToolResult({
        session: '1',
        ask: 'bar chart of Sales by Region sorted descending',
        auto_apply: true,
        getExecutor,
      }),
    );

    expect(second.reused).toBeUndefined();
    expect(second.applied).toBe(true);
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(2);

    // And a top-N refinement on top of that is a third distinct sheet state.
    bindReturning(boundWithSortAndTopNResult);
    const third = body(
      await getToolResult({
        session: '1',
        ask: 'top 10 regions by Sales, sorted descending',
        auto_apply: true,
        getExecutor,
      }),
    );
    expect(third.reused).toBeUndefined();
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(3);
  });

  it('an explicit target_worksheet always applies, even for byte-identical args', async () => {
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_WORKBOOK_WITH_NEW_SHEET_WINDOW },
    });

    await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });

    const second = body(
      await getToolResult({
        session: '1',
        ask: 'bar chart of Sales by Region',
        auto_apply: true,
        target_worksheet: 'Sales by Region',
        getExecutor,
      }),
    );

    expect(second.reused).toBeUndefined();
    expect(second.applied).toBe(true);
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(2);
  });

  it('admits an explicit target_worksheet rebuild through a terminal same-ask record', async () => {
    const ask = 'bar chart of Sales by Region';
    const askKey = normalizeAskForMatch(ask);
    sessionRouteState.recordBindRecoveryTerminal('1', askKey, { outcome: 'escalate' });
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_WORKBOOK_WITH_NEW_SHEET_WINDOW },
    });

    const rebuilt = body(
      await getToolResult({
        session: '1',
        ask,
        auto_apply: true,
        target_worksheet: 'Sales by Region',
        getExecutor,
      }),
    );

    expect(rebuilt).toMatchObject({
      status: 'bound',
      applied: true,
      sheet_name: 'Sales by Region',
    });
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
    expect(sessionRouteState.getBindRecovery('1', askKey)).toBeUndefined();
  });

  it('rebuilds when the remembered sheet is no longer in the workbook', async () => {
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_WORKBOOK_WITH_NEW_SHEET_WINDOW },
    });

    await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });

    // The user deleted the sheet in Desktop between the two calls.
    vi.mocked(classifyWorksheetReplaceTarget).mockReturnValue('not-found');
    const second = body(
      await getToolResult({
        session: '1',
        ask: 'bar chart of Sales by Region',
        auto_apply: true,
        getExecutor,
      }),
    );

    expect(second.reused).toBeUndefined();
    expect(second.applied).toBe(true);
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(2);
  });

  it('does not leak across sessions', async () => {
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_WORKBOOK_WITH_NEW_SHEET_WINDOW },
    });

    await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });
    const otherSession = body(
      await getToolResult({
        session: '2',
        ask: 'bar chart of Sales by Region',
        auto_apply: true,
        getExecutor,
      }),
    );

    expect(otherSession.reused).toBeUndefined();
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(2);
  });

  it('remembers nothing when auto_apply did not apply', async () => {
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_WORKBOOK_WITH_NEW_SHEET_WINDOW },
    });

    await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: false,
      getExecutor,
    });
    const second = body(
      await getToolResult({
        session: '1',
        ask: 'bar chart of Sales by Region',
        auto_apply: true,
        getExecutor,
      }),
    );

    expect(second.reused).toBeUndefined();
    expect(second.applied).toBe(true);
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
  });
});

// A confident bind that applied cleanly, but whose ask asked for a color encoding the
// binder could not fill. This is the live flat-blue symbol map: correct dots, no color.
const boundWithUnfilledColorResult: BinderResult = {
  ...boundResult,
  encodings: { filled: ['size'], unfilled: ['color'] },
};

describe('bind-template — reports what it actually built', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(externalDiscovery.discoverInstances).mockReturnValue([]);
  });

  it('does NOT report done when a requested encoding went unfilled', async () => {
    const { getExecutor } = setupAutoApplyMocks({ bind: boundWithUnfilledColorResult });

    const result = await getToolResult({
      session: '1',
      ask: 'symbol map of Sales by State, warmer dots for more sales',
      auto_apply: true,
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(body.applied).toBe(true);
    // The apply succeeded, so the sheet is real — but the tool must not call it complete.
    expect(result.structuredContent).not.toEqual({
      nextAction: { label: 'Chart complete — no further calls needed', kind: 'done' },
    });
    expect(
      (result.structuredContent as { nextAction: { kind: string } } | undefined)?.nextAction.kind,
    ).not.toBe('done');
    expect(body.guidance).not.toContain('no further tool calls');
  });

  it('names the missing encoding and the concrete next call', async () => {
    const { getExecutor } = setupAutoApplyMocks({ bind: boundWithUnfilledColorResult });

    const result = await getToolResult({
      session: '1',
      ask: 'symbol map of Sales by State, warmer dots for more sales',
      auto_apply: true,
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
    const guidance = body.guidance as string;
    // Name the encoding that is missing...
    expect(guidance).toContain('color');
    // ...and the concrete call that fixes it, on THIS sheet.
    expect(guidance).toContain('add-field');
    expect(guidance).toContain("encodingType:'color'");
    expect(guidance).toContain('apply-worksheet');
    expect(guidance).toContain('Sales by Region');
    // The measured failure mode is the model re-wording the same ask at bind-template.
    expect(guidance).toContain('Do NOT call bind-template again');
    // The machine-readable half must point at the same action.
    expect(
      (result.structuredContent as { nextAction: { label: string } }).nextAction.label,
    ).toContain('apply-worksheet');
  });

  it('resolves one confidently named encoding field to its exact column ref', async () => {
    const { getExecutor } = setupAutoApplyMocks({
      bind: boundWithUnfilledColorResult,
      workbookReads: [ENCODING_GUIDANCE_XML],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'symbol map of countries with size and color both encoding Goals For',
      auto_apply: true,
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const guidance = JSON.parse(result.content[0].text).guidance as string;
    expect(guidance).toContain("encodingType:'color',columnRef:'[World Cup].[sum:goals_for:qk]'");
    expect(guidance).not.toContain('columnRef:<field>');
  });

  it('lists exact refs and captions when encoding field resolution is ambiguous', async () => {
    const { getExecutor } = setupAutoApplyMocks({
      bind: boundWithUnfilledColorResult,
      workbookReads: [ENCODING_GUIDANCE_XML],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'symbol map of countries with color encoding Goals For and Goals',
      auto_apply: true,
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const guidance = JSON.parse(result.content[0].text).guidance as string;
    expect(guidance).toContain('columnRef:<one of:');
    expect(guidance).toContain("'[World Cup].[sum:goals_for:qk]' ('Goals For')");
    expect(guidance).toContain("'[World Cup].[sum:goals:qk]' ('Goals')");
  });

  it('keeps the field placeholder when the ask names no encoding field candidate', async () => {
    const { getExecutor } = setupAutoApplyMocks({
      bind: boundWithUnfilledColorResult,
      workbookReads: [ENCODING_GUIDANCE_XML],
    });

    const result = await getToolResult({
      session: '1',
      ask: 'symbol map with color intensity',
      auto_apply: true,
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const guidance = JSON.parse(result.content[0].text).guidance as string;
    expect(guidance).toContain("encodingType:'color',columnRef:<field>");
    expect(guidance).not.toContain('columnRef:<one of:');
  });

  it('reports the filled and unfilled encodings in the body', async () => {
    const { getExecutor } = setupAutoApplyMocks({ bind: boundWithUnfilledColorResult });

    const result = await getToolResult({
      session: '1',
      ask: 'symbol map of Sales by State, warmer dots for more sales',
      auto_apply: true,
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(body.encodings).toEqual({ filled: ['size'], unfilled: ['color'] });
  });

  it('a fully satisfied bind still reports done exactly as today (no regression)', async () => {
    const { getExecutor } = setupAutoApplyMocks();

    const result = await getToolResult({
      session: '1',
      ask: 'symbol map of Sales by State',
      auto_apply: true,
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expectStructuredBlock(result, COMPLETE_BIND_NEXT_ACTION);
    expect(body.guidance).toContain('no further tool calls');
    // This fixture cannot serve summary rows, so the advisory failure is explicit.
    expect(Object.keys(body).sort()).toEqual([
      'applied',
      'guidance',
      'phase_ms',
      'sheet_name',
      'status',
      'summary_rows_error',
    ]);
    expect(body.encodings).toBeUndefined();
  });

  it('keeps the nextAction label legal when every encoding is unfilled', async () => {
    // nextAction labels throw above 60 chars, so the widest possible steer must still fit.
    const { getExecutor } = setupAutoApplyMocks({
      bind: {
        ...boundResult,
        encodings: { filled: [], unfilled: ['size', 'color', 'tooltip'] },
      },
    });

    const result = await getToolResult({
      session: '1',
      ask: 'symbol map of Sales by State, bigger warmer dots, goals on hover',
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    const { label } = (result.structuredContent as { nextAction: { label: string } }).nextAction;
    expect(label.length).toBeLessThanOrEqual(60);
    expect(label).toContain('color');
  });

  it('chains every additional encoding edit through the previously returned worksheet file', async () => {
    const { getExecutor } = setupAutoApplyMocks({
      bind: {
        ...boundResult,
        encodings: { filled: [], unfilled: ['size', 'color', 'tooltip'] },
      },
    });

    const result = await getToolResult({
      session: '1',
      ask: 'symbol map of Sales by State, bigger warmer dots, goals on hover',
      auto_apply: true,
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const guidance = JSON.parse(result.content[0].text).guidance as string;
    expect(guidance).toContain(
      "add-field{worksheetName:'Sales by Region',target:'encoding',encodingType:'size'",
    );
    expect(guidance).toContain(
      "add-field{worksheetFile:<path returned by previous add-field>,target:'encoding',encodingType:'color'",
    );
    expect(guidance).toContain(
      "add-field{worksheetFile:<path returned by previous add-field>,target:'encoding',encodingType:'tooltip'",
    );
    expect(guidance).toContain(
      "apply-worksheet{worksheetName:'Sales by Region',worksheetFile:<path returned by previous add-field>}",
    );
  });
});

// ── An incomplete bind must not be remembered as an applied sheet ─────────────
// Two behaviours that are each correct alone combine into a wrong answer. An
// incomplete bind returns applied:true with a non-empty encodings.unfilled, and the
// duplicate-sheet reuse path remembers every applied:true bind and replays it as a
// terminal "already built" on the next reworded ask. Together they tell the agent a
// chart the binder itself called incomplete is finished, and the missing encoding is
// never filled.
describe('bindTemplateTool incomplete bind is not remembered as applied', () => {
  function body(result: CallToolResult): Record<string, unknown> {
    invariant(result.content[0].type === 'text');
    return JSON.parse(result.content[0].text);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(externalDiscovery.discoverInstances).mockReturnValue([]);
    vi.mocked(classifyWorksheetReplaceTarget).mockReturnValue('replaceable');
  });

  it('marks a skipped requested sort incomplete after clean readback and does not remember it', async () => {
    invariant(boundWithSortResult.status === 'bound');
    const skippedSortBind: BinderResult = {
      ...boundWithSortResult,
      args: {
        ...boundWithSortResult.args,
        sort: { by: 'Missing Sales', direction: 'desc' },
      },
    };
    const mocks = setupAutoApplyMocks({
      bind: skippedSortBind,
      inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML },
    });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region sorted by Missing Sales',
      proposal: { ...sampleProposal, sort: { by: 'Missing Sales', direction: 'desc' } },
      auto_apply: true,
      getExecutor: readbackExecutor(mocks),
    });
    const first = body(result);

    expect(first.warnings).toEqual([expect.stringContaining('sort splice skipped')]);
    expect(first.guidance).toContain('HOST VERIFICATION — verified');
    // No terminal marker plus no memory is the public contract produced by incomplete:true.
    expect(
      (result.structuredContent as { nextAction?: { kind: string } } | undefined)?.nextAction?.kind,
    ).not.toBe('done');
    expect(
      sessionRouteState.getAppliedSheet('1', appliedSheetSignature(skippedSortBind.args)),
    ).toBeUndefined();
  });

  it('surfaces a computed-sort drop from template rewriting as an incomplete warning', async () => {
    const warning = 'computed-sort dropped: [Superstore].[sum:Optional Sort:qk] did not resolve';
    const mocks = setupAutoApplyMocks({
      inject: {
        ok: true,
        xml: INJECTED_RANKING_WORKBOOK_XML,
        warnings: [warning],
      },
    });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor: readbackExecutor(mocks),
    });
    const receipt = body(result);

    expect(receipt.warnings).toEqual([warning]);
    expect(
      (result.structuredContent as { nextAction?: { kind: string } } | undefined)?.nextAction?.kind,
    ).not.toBe('done');
  });

  it('a reworded re-bind after an incomplete bind is not reported as already built', async () => {
    const { getExecutor } = setupAutoApplyMocks({
      bind: boundWithUnfilledColorResult,
      inject: { ok: true, xml: INJECTED_WORKBOOK_WITH_NEW_SHEET_WINDOW },
    });

    const first = body(
      await getToolResult({
        session: '1',
        ask: 'symbol map of Sales by State, warmer dots for more sales',
        auto_apply: true,
        getExecutor,
      }),
    );
    expect(first.applied).toBe(true);
    expect((first.encodings as { unfilled: string[] }).unfilled).toEqual(['color']);

    // The same chart in new words with no target_worksheet: the exact re-bind the
    // duplicate-sheet reuse path is built to collapse.
    invariant(boundWithUnfilledColorResult.status === 'bound');
    const rewordedAsk = 'color the Sales by State dots by how much they sold';
    vi.mocked(binderModule.bindTemplate).mockResolvedValue({
      ...boundWithUnfilledColorResult,
      args: { ...boundWithUnfilledColorResult.args, title: rewordedAsk },
    });

    const secondResult = await getToolResult({
      session: '1',
      ask: rewordedAsk,
      auto_apply: true,
      getExecutor,
    });
    const second = body(secondResult);

    // Call 1 declared the chart incomplete, so nothing may now declare it finished.
    expect(second.reused).toBeUndefined();
    expect(second.guidance).not.toContain('already built');
    expect(second.guidance).not.toContain('no further tool calls needed');
    expect(
      (secondResult.structuredContent as { nextAction: { kind: string } } | undefined)?.nextAction
        .kind,
    ).not.toBe('done');
    // ...and the unfilled encoding is still named, so the steer survives the reword.
    expect(second.guidance).toContain('color');
  });

  it('a complete bind is still remembered — the reuse path is untouched', async () => {
    const { applyWorkbookDocument, getExecutor } = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_WORKBOOK_WITH_NEW_SHEET_WINDOW },
    });

    await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });

    invariant(boundResult.status === 'bound');
    vi.mocked(binderModule.bindTemplate).mockResolvedValue({
      ...boundResult,
      args: { ...boundResult.args, title: 'Sales by Region, bars' },
    });
    const second = body(
      await getToolResult({
        session: '1',
        ask: 'Sales by Region, bars',
        auto_apply: true,
        getExecutor,
      }),
    );

    expect(second.reused).toBe(true);
    expect(second.guidance).toContain('still present by name');
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
  });
});

// ── The bind hot path verifies what it wrote (W-23447506) ────────────────────
// apply-worksheet and build-and-apply-worksheet re-read the sheet they just wrote and
// report what the host saw. bind-template applied through loadWorkbookXml, which has no
// readback, so "Applied ..." meant only "Desktop accepted a document". These tests pin the
// receipt to a real comparison: a clean readback earns a verified line, a dropped node
// loses the done marker, and an unreadable sheet adds nothing at all.
describe('bindTemplateTool host verification on the bind hot path', () => {
  function body(result: CallToolResult): Record<string, unknown> {
    invariant(result.content[0].type === 'text');
    return JSON.parse(result.content[0].text);
  }

  function terminalReceipt(result: CallToolResult): {
    did: string[];
    didNot: string[];
    unverified: string[];
  } {
    const nextAction = (
      result.structuredContent as
        | {
            nextAction?: {
              receipt?: { did: string[]; didNot: string[]; unverified: string[] };
            };
          }
        | undefined
    )?.nextAction;
    invariant(nextAction?.receipt);
    return nextAction.receipt;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(externalDiscovery.discoverInstances).mockReturnValue([]);
    vi.mocked(classifyWorksheetReplaceTarget).mockReturnValue('replaceable');
  });

  it('a clean readback earns a verified host line', async () => {
    const mocks = setupAutoApplyMocks({ inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML } });

    const applied = body(
      await getToolResult({
        session: '1',
        ask: 'bar chart of Sales by Region',
        auto_apply: true,
        getExecutor: readbackExecutor(mocks),
      }),
    );

    expect(applied.applied).toBe(true);
    expect(applied.guidance).toContain('HOST VERIFICATION — verified');
    expect(applied.guidance).toContain('readback clean');
    // The stop clause survives: a verified receipt must not re-open the re-bind spiral.
    expect(applied.guidance).toContain('Done — no further tool calls needed');
  });

  it('a dropped node is reported and the bind is no longer terminal', async () => {
    const mocks = setupAutoApplyMocks({ inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML } });
    // Tableau accepted the document but rendered a different mark than the one we wrote.
    let read = 0;
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockImplementation(async () =>
      Ok(
        read++ === 0
          ? XML
          : INJECTED_RANKING_WORKBOOK_XML.replace(
              "<mark class='Bar' />",
              "<mark class='Circle' />",
            ),
      ),
    );

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor: readbackExecutor(mocks),
    });
    const applied = body(result);

    expect(applied.applied).toBe(true);
    expect(applied.guidance).toContain('HOST VERIFICATION — failed');
    expect(applied.guidance).toContain('readback FAILED (nodes dropped)');
    expect(applied.guidance).not.toContain('Done — no further tool calls needed');
    expect(
      (result.structuredContent as { nextAction?: { kind: string } } | undefined)?.nextAction?.kind,
    ).not.toBe('done');
  });

  it('an unreadable sheet adds no line rather than claiming a check that never ran', async () => {
    // The default executor has no listWorksheets, so the readback cannot run at all.
    const { getExecutor } = setupAutoApplyMocks({
      inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML },
    });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });
    const applied = body(result);
    const receipt = terminalReceipt(result);

    expect(applied.applied).toBe(true);
    expect(applied.guidance).not.toContain('HOST VERIFICATION');
    expect(applied.guidance).toContain('Done — no further tool calls needed');
    expect(receipt.unverified.join(' ')).not.toContain('readback compares XML structure');
    expect(receipt.unverified.join(' ')).toContain('structural readback did not run');
  });

  it('does not claim all encodings were bound when no encoding analysis ran', async () => {
    const { getExecutor } = setupAutoApplyMocks({
      bind: { ...boundResult, encodings: undefined },
      inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML },
    });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });
    const receipt = terminalReceipt(result);

    expect(receipt.did).not.toContain('bound every encoding named in the binder encoding report');
    expect(receipt.unverified.join(' ')).toContain('encoding analysis did not run');
  });

  it('a complete encoding analysis earns the positive receipt and no did-not-run warning', async () => {
    const { getExecutor } = setupAutoApplyMocks({
      bind: { ...boundResult, encodings: { filled: ['size', 'color'], unfilled: [] } },
      inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML },
    });

    const result = await getToolResult({
      session: '1',
      ask: 'symbol map of Sales by State, sized and colored by Sales',
      auto_apply: true,
      getExecutor,
    });
    const receipt = terminalReceipt(result);

    expect(receipt.did).toContain('bound every encoding named in the binder encoding report');
    expect(receipt.unverified.join(' ')).not.toContain('encoding analysis did not run');
  });

  it('names a skipped splice warning as work left undone', async () => {
    const { getExecutor } = setupAutoApplyMocks({
      bind: {
        ...boundResult,
        args: {
          ...boundResult.args,
          filters: [{ field: 'Missing Region', context: true }],
        },
      } as BinderResult,
      inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML },
    });

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region filtered by Missing Region',
      auto_apply: true,
      getExecutor,
    });
    const applied = body(result);
    const warnings = applied.warnings as string[];

    expect(warnings).toEqual([expect.stringContaining('filter splice skipped')]);
    expect(applied.guidance).not.toContain('requested filter is ALREADY applied');
    // A skipped request cannot have a terminal receipt: its warning is the unfinished work.
    expect(applied.guidance).not.toContain('Done — no further tool calls needed');
    expect(
      (result.structuredContent as { nextAction?: { kind: string } } | undefined)?.nextAction?.kind,
    ).not.toBe('done');
  });

  it('a WARNING-severity dropped promised sort is incomplete and not terminal', async () => {
    const mocks = setupAutoApplyMocks({
      bind: boundWithSortResult,
      inject: { ok: true, xml: INJECTED_RANKING_WORKBOOK_XML },
    });
    let read = 0;
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockImplementation(async () =>
      Ok(read++ === 0 ? XML : INJECTED_RANKING_WORKBOOK_XML),
    );

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region sorted descending',
      proposal: { ...sampleProposal, sort: { by: 'Sales', direction: 'desc' } },
      auto_apply: true,
      getExecutor: readbackExecutor(mocks),
    });
    const applied = body(result);

    expect(applied.guidance).toContain('HOST VERIFICATION — failed');
    expect(applied.guidance).toContain('<computed-sort');
    expect(applied.guidance).not.toContain('Done — no further tool calls needed');
    expect(
      (result.structuredContent as { nextAction?: { kind: string } } | undefined)?.nextAction?.kind,
    ).not.toBe('done');
  });
});

// ── A recoverable escalation hands over the candidate shortlist ───────────────
// Only `propose` used to carry candidate_templates. An agent told to re-propose after an
// ambiguous-field / field-not-found / low-confidence escalation had nothing to propose from
// and went hunting — the live transcript shows search-commands answering an encoding ask
// with mapbox logging and device-layout removal, then a whole knowledge document read.
describe('bindTemplateTool escalate candidate handover', () => {
  const ESCALATE_WORKBOOK_XML = `<?xml version='1.0' encoding='utf-8'?>
<workbook>
  <datasources>
    <datasource name='Superstore'>
      <column caption='Region' name='[Region]' role='dimension' type='nominal' datatype='string' />
      <column caption='Sales' name='[Sales]' role='measure' type='quantitative' datatype='real' />
    </datasource>
  </datasources>
</workbook>`;

  function body(result: CallToolResult): Record<string, unknown> {
    invariant(result.content[0].type === 'text');
    return JSON.parse(result.content[0].text);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(externalDiscovery.discoverInstances).mockReturnValue([]);
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(ESCALATE_WORKBOOK_XML));
    // Real bundled manifests: the shortlist is only meaningful against real slots, and an
    // earlier describe leaves a one-entry stub on this seam.
    vi.spyOn(bundledIntelligenceProvider, 'listTemplateManifests').mockReturnValue([
      ...loadManifests().values(),
    ]);
  });

  it('names a template and the fields that fit each of its slots', async () => {
    vi.mocked(binderModule.bindTemplate).mockResolvedValue({
      status: 'escalate',
      reason: 'low-confidence',
      blockers: [{ code: 'low-confidence', detail: 'confidence 0.2 < min 0.6' }],
    });

    const escalated = body(
      await getToolResult({ session: '1', ask: 'bar chart of Sales by Region' }),
    );

    const contract = escalated.call_2_contract as {
      tool: string;
      proposal_choices: Array<{
        template: string;
        slots: Array<{ slot_id: string; compatible_field_names: string[] }>;
      }>;
    };
    expect(contract.tool).toBe('bind-template');
    expect(contract.proposal_choices.length).toBeGreaterThan(0);
    const everyCompatibleName = contract.proposal_choices.flatMap((choice) =>
      choice.slots.flatMap((slot) => slot.compatible_field_names),
    );
    expect(everyCompatibleName).toContain('Sales');
    expect(everyCompatibleName).toContain('Region');
    expect(escalated.guidance).toContain('call_2_contract.proposal_choices');
  });

  it('withholds the contract on a Tier-2 escalation, whose next call is blocked anyway', async () => {
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(tier2EscalateResult);

    const escalated = body(
      await getToolResult({ session: '1', ask: 'ou difference chart of Sales by Region' }),
    );

    expect(escalated.status).toBe('escalate');
    expect(escalated.call_2_contract).toBeUndefined();
    // Never advertise a payload that is not there.
    expect(escalated.guidance).not.toContain('call_2_contract.proposal_choices');
    expect(escalated.guidance).toContain('build-and-apply-worksheet');
  });
});
