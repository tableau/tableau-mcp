import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import type { BinderResult, BindingProposal } from '../../../desktop/binder/binder.js';
import * as binderModule from '../../../desktop/binder/binder.js';
import { loadManifests } from '../../../desktop/binder/manifest.js';
import type { TemplateManifest } from '../../../desktop/binder/manifest-types.js';
import * as routeSpecModule from '../../../desktop/binder/route-spec.js';
import { normalizeAskForMatch } from '../../../desktop/binder/route-spec.js';
import * as getWorkbookXmlModule from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { DesktopDiscoverer } from '../../../desktop/desktopDiscoverer.js';
import { bundledIntelligenceProvider } from '../../../desktop/intelligence/provider.js';
import * as xmlToJsonModule from '../../../desktop/libraries/workbook-serialization-converter/index.js';
import { sessionRouteState } from '../../../desktop/route/route-state.js';
import { buildInjectedWorkbookXml } from '../../../desktop/templates/injectTemplateCore.js';
import { readTemplate } from '../../../desktop/templates/templatePath.js';
import type { ExecuteCommandArgs } from '../../../desktop/toolExecutor/toolExecutor.js';
import * as validationRegistry from '../../../desktop/validation/registry.js';
import {
  DesktopCommandExecutionError,
  NoDesktopInstancesFoundError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getBindTemplateTool } from './bindTemplate.js';

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
// only the boundaries are mocked. DesktopDiscoverer is mocked for session-default
// resolution. The shared inject core is stubbed (its transform is proven by
// injectTemplate's own suite) so these tests own only the bind-template wiring.
vi.mock('../../../desktop/desktopDiscoverer.js');
vi.mock('../../../desktop/libraries/workbook-serialization-converter/index.js');
vi.mock('../../../desktop/templates/injectTemplateCore.js', () => ({
  buildInjectedWorkbookXml: vi.fn(),
}));
vi.mock('../../../desktop/templates/templatePath.js');
vi.mock('../../../desktop/validation/registry.js');
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
  llm_input: {
    ask: 'bar chart of Sales by Region',
    candidate_templates: [],
    fields: [],
  } as unknown as Extract<BinderResult, { status: 'propose' }>['llm_input'],
  output_schema: { type: 'object' },
};

const escalateResult: BinderResult = {
  status: 'escalate',
  reason: 'field-not-found',
  blockers: [{ code: 'field-not-found', slot_id: 'val', detail: 'No field named "Revenue".' }],
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

describe('bindTemplateTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getBindTemplateTool(new DesktopMcpServer());
    expect(tool.name).toBe('bind-template');
    expect(tool.description).toBe('Bind/apply template; calcs[] first.');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      ask: expect.any(Object),
      proposal: expect.any(Object),
      minConfidence: expect.any(Object),
      calcs: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({
      title: 'Bind Template',
      readOnlyHint: true,
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

  it('returns status "propose" (not an error) with next-step guidance (Call 1 miss)', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(proposeResult);

    const result = await getToolResult({ session: '1', ask: 'something weird' });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.status).toBe('propose');
    expect(body.output_schema).toEqual({ type: 'object' });
    expect(body.guidance).toContain('output_schema');
  });

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
    const expectedBody = {
      ...escalateResult,
      guidance:
        'Escalated (field-not-found). No worksheet was produced. Blockers: ' +
        '[field-not-found] slot \'val\' No field named "Revenue".. Next: Resolve the field(s) ' +
        'with the resolve-field tool, then call bind-template again with a corrected proposal; ' +
        'otherwise ask the user with ask-user (present the candidates).',
    };
    expect(result.content[0].text).toBe(JSON.stringify(expectedBody));
    expect(result.structuredContent).toEqual({
      nextAction: { label: 'Resolve the fields first; otherwise ask the user', kind: 'prefill' },
    });
    const body = JSON.parse(result.content[0].text);
    expect(body.status).toBe('escalate');
    expect(body.reason).toBe('field-not-found');
    expect(body.guidance).toContain('field-not-found');
    expect(body.guidance).toContain('resolve-field');
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

async function getToolResult({
  session,
  ask,
  proposal,
  minConfidence,
  auto_apply,
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

  return await callback({ session, ask, proposal, minConfidence, auto_apply, calcs } as any, extra);
}

/**
 * Wire the auto-apply seams for one bind-template call. Returns the executor's
 * `executeCommand` spy (the apply dispatch) and the `getExecutor` factory to hand
 * to {@link getToolResult}. Defaults reproduce a happy Call-1 bind of a fast-path
 * template whose inject succeeds and whose validated apply dispatches Ok.
 */
function setupAutoApplyMocks({
  bind = boundResult,
  fastPathEligible = true,
  inject = { ok: true as const, xml: '<workbook/>' },
  validationValid = true,
  dispatch = Ok({ command_id: 'cmd-1', status: 'completed', submitted_at: '', result: {} }),
  workbookReads = [XML],
  // Events-clean gate (W60): 0 = clean workbook (gate passes); N>0 = the user touched
  // the workbook between read and apply; 'unsupported' = executor without events
  // (gate is best-effort and must NOT block auto_apply).
  userEventsDuringBind = 0,
}: {
  bind?: BinderResult;
  fastPathEligible?: boolean;
  inject?: { ok: true; xml: string } | { ok: false; issues: string[] };
  validationValid?: boolean;
  dispatch?: ReturnType<typeof Ok> | ReturnType<typeof Err>;
  workbookReads?: string[];
  userEventsDuringBind?: number | 'unsupported';
} = {}): {
  executeCommand: ReturnType<typeof vi.fn>;
  getEvents: ReturnType<typeof vi.fn>;
  getExecutor: ReturnType<typeof vi.fn>;
} {
  const getWorkbookXmlSpy = vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml');
  for (const xml of workbookReads) {
    getWorkbookXmlSpy.mockResolvedValueOnce(Ok(xml));
  }
  getWorkbookXmlSpy.mockResolvedValue(Ok(workbookReads.at(-1) ?? XML));
  vi.mocked(binderModule.bindTemplate).mockResolvedValue(bind);
  vi.spyOn(bundledIntelligenceProvider, 'listTemplateManifests').mockReturnValue([
    { template: 'bar-basic', fast_path_eligible: fastPathEligible } as unknown as TemplateManifest,
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

  const executeCommand = vi.fn().mockResolvedValue(dispatch);
  const getEvents =
    userEventsDuringBind === 'unsupported'
      ? vi.fn().mockResolvedValue(Err('events unsupported on this transport'))
      : vi
          .fn()
          // 1st call: the pre-bind anchor. 2nd call: the pre-apply cleanliness check.
          .mockResolvedValueOnce(Ok({ events: [], latest_sequence: 41, count: 0 }))
          .mockResolvedValue(
            Ok({
              events: Array.from({ length: userEventsDuringBind }, (_, i) => ({ id: i })),
              latest_sequence: 41 + userEventsDuringBind,
              count: userEventsDuringBind,
            }),
          );
  const getExecutor = vi.fn().mockResolvedValue({ executeCommand, getEvents });
  return { executeCommand, getEvents, getExecutor };
}

describe('bindTemplateTool auto_apply gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('auto_apply=true on a Call-1 bind applies server-side exactly once', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks();

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
    // Exactly one apply dispatch (the collapsed 4-call chain becomes one tool call).
    expect(executeCommand).toHaveBeenCalledTimes(1);
  });

  it('applied:true returns ONLY the trimmed fast-path shape (W60 P4 response-shape trim)', async () => {
    const { getExecutor } = setupAutoApplyMocks();

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
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
    ]);
    expect(body.status).toBe('bound');
    expect(body.apply_instruction).toBeUndefined();
    expect(body.apply_hint).toBeUndefined();
    expect(body.used_llm).toBeUndefined();
    // Guidance collapses to one short line, not the verbose manual-chain instruction.
    expect(typeof body.guidance).toBe('string');
    expect((body.guidance as string).length).toBeLessThan(200);
  });

  it('auto_apply=true applies a validated Call-2 proposal bind with the events anchor', async () => {
    const { executeCommand, getEvents, getExecutor } = setupAutoApplyMocks({
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
    expect(executeCommand).toHaveBeenCalledTimes(1);
    expect(getEvents).toHaveBeenCalledTimes(2);
    expect(getEvents).toHaveBeenNthCalledWith(2, {
      signal: expect.any(AbortSignal),
      sinceSequence: 41,
    });
  });

  it('auto_apply=true splices proposal sort into the applied workbook XML', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks({
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
    expect(appliedXml(executeCommand)).toContain(
      "<computed-sort column='[Superstore].[none:Region:nk]' direction='DESC' using='[Superstore].[sum:Sales:qk]' />",
    );
  });

  it('auto_apply=true splices proposal top_n into the applied workbook XML', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks({
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
    expect(appliedXml(executeCommand)).toMatch(/function='end'\s+end='top'\s+count='10'/);
    expect(appliedXml(executeCommand)).toContain(
      '<slices><column>[Superstore].[none:Region:nk]</column></slices>',
    );
  });

  it('auto_apply=true splices proposal sort and top_n together in one apply', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks({
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
    expect(executeCommand).toHaveBeenCalledTimes(1);
    const xml = appliedXml(executeCommand);
    expect(xml).toContain(
      "<computed-sort column='[Superstore].[none:Region:nk]' direction='DESC' using='[Superstore].[sum:Sales:qk]' />",
    );
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
    const { executeCommand, getEvents, getExecutor } = setupAutoApplyMocks({
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
    expect(
      commandCalls(executeCommand).filter((call) => call.command === 'load-underlying-metadata'),
    ).toHaveLength(2);
    expect(getEvents).toHaveBeenCalledTimes(2);
    expect(getEvents).toHaveBeenNthCalledWith(2, {
      signal: expect.any(AbortSignal),
      sinceSequence: 41,
    });
  });

  it('rejects invalid inline calcs before any document load or bind', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks({
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
    expect(
      commandCalls(executeCommand).some((call) => call.command === 'load-underlying-metadata'),
    ).toBe(false);
    expect(binderModule.bindTemplate).not.toHaveBeenCalled();
    expect(buildInjectedWorkbookXml).not.toHaveBeenCalled();
  });

  it('auto_apply=true leaves a propose outcome unchanged (no apply)', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks({ bind: proposeResult });

    const result = await getToolResult({
      session: '1',
      ask: 'something weird',
      auto_apply: true,
      getExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.status).toBe('propose');
    expect(body.applied).toBeUndefined();
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('reports authored calcs when the subsequent bind proposes', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const { executeCommand, getExecutor } = setupAutoApplyMocks({
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
    expect(
      commandCalls(executeCommand).filter((call) => call.command === 'load-underlying-metadata'),
    ).toHaveLength(1);
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
    const { executeCommand, getExecutor } = setupAutoApplyMocks();

    await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });

    expect(validationRegistry.runValidation).toHaveBeenCalledTimes(1);
    expect(validationRegistry.runValidation).toHaveBeenCalledWith('<workbook/>', 'workbook');
    expect(executeCommand).toHaveBeenCalledTimes(1);
    const validationOrder = vi.mocked(validationRegistry.runValidation).mock.invocationCallOrder[0];
    const dispatchOrder = executeCommand.mock.invocationCallOrder[0];
    expect(validationOrder).toBeLessThan(dispatchOrder);
  });
});

describe('bindTemplateTool auto_apply graceful fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(false);
    expect(body.apply_error).toContain('inject failed');
    expect(body.apply_error).toContain('not well-formed');
    // The bind is never lost — args are intact for the manual fallback chain.
    expect(body.args).toEqual(boundResult.status === 'bound' ? boundResult.args : undefined);
    // P1-5 contrast: inject/validation/apply failures did NOT stem from a stale
    // workbook, so the "fall back to the manual chain using the returned args" guidance
    // is correct here and must be retained (only the events-dirty branch drops it).
    expect(String(body.guidance)).toMatch(/manual chain/i);
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

    expect(result.isError).toBe(false);
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

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(false);
    expect(body.apply_error).toContain('preflight validation failed');
    // Preflight gates the dispatch — the invalid XML is never sent.
    expect(executeCommand).not.toHaveBeenCalled();
  });
});

describe('bindTemplateTool session-default-when-unique', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockInstances(pids: number[]): void {
    const map = new Map(pids.map((pid) => [pid, { pid }]));
    vi.mocked(DesktopDiscoverer).mockImplementation(
      () => ({ getInstances: () => map }) as unknown as DesktopDiscoverer,
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

  it('an explicit session always wins (discovery is never consulted)', async () => {
    // Even with 2+ instances running, an explicit session bypasses discovery.
    mockInstances([11, 22]);
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(boundResult);
    const getExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      session: '7',
      ask: 'bar chart of Sales by Region',
      getExecutor,
    });

    expect(result.isError).toBe(false);
    expect(getExecutor).toHaveBeenCalledWith('7');
    expect(DesktopDiscoverer).not.toHaveBeenCalled();
  });
});

describe('bindTemplateTool auto_apply — events-clean gate (W60 blind-spot #1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses to auto-apply over a workbook the user touched mid-bind (falls back, bind intact)', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks({ userEventsDuringBind: 3 });
    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });
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
    const { executeCommand, getExecutor } = setupAutoApplyMocks({ userEventsDuringBind: 0 });
    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(body.applied).toBe(true);
    expect(executeCommand).toHaveBeenCalled();
  });

  it('gate is best-effort: an executor without event support still auto-applies (Athena residual)', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks({
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
    expect(executeCommand).toHaveBeenCalled();
  });
});

describe('bindTemplateTool route-state recording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

function commandCalls(
  executeCommand: ReturnType<typeof vi.fn>,
): Array<ExecuteCommandArgs<undefined>> {
  return executeCommand.mock.calls.map(([call]) => call);
}

function appliedXml(executeCommand: ReturnType<typeof vi.fn>): string {
  const call = commandCalls(executeCommand).find(
    (candidate) => candidate.command === 'load-underlying-metadata',
  );
  return String((call?.args as { text?: string } | undefined)?.text ?? '');
}
