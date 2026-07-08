import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import type { BinderResult, BindingProposal } from '../../../desktop/binder/binder.js';
import * as binderModule from '../../../desktop/binder/binder.js';
import type { TemplateManifest } from '../../../desktop/binder/manifest-types.js';
import * as getWorkbookXmlModule from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { DesktopDiscoverer } from '../../../desktop/desktopDiscoverer.js';
import { bundledIntelligenceProvider } from '../../../desktop/intelligence/provider.js';
import * as xmlToJsonModule from '../../../desktop/libraries/workbook-serialization-converter/index.js';
import { buildInjectedWorkbookXml } from '../../../desktop/templates/injectTemplateCore.js';
import { getTemplatePath } from '../../../desktop/templates/templatePath.js';
import { ExecuteCommandError } from '../../../desktop/toolExecutor/toolExecutor.js';
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
// Partial fs mock: bind-template reads the bound template via the NAMED `readFileSync`
// import, so stub ONLY the sentinel mock-template path. Real manifest/content reads go
// through the DEFAULT fs import (manifest.ts / provider.ts) and stay live, so the
// existing tests that exercise the bundled provider for real are unaffected.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: (actual as unknown as { default?: typeof actual }).default ?? actual,
    readFileSync: vi.fn((path: unknown, ...rest: unknown[]) => {
      if (typeof path === 'string' && path.includes('mock-templates')) {
        return '<template/>';
      }
      return (actual.readFileSync as (...a: unknown[]) => unknown)(path, ...rest);
    }),
    writeFileSync: vi.fn(),
  };
});

const XML = '<?xml version="1.0"?><workbook></workbook>';

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
// The auto-apply gate must refuse it even with the flag set AND a fast-path manifest.
const boundViaProposalResult: BinderResult = { ...boundResult, used_llm: true };

describe('bindTemplateTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getBindTemplateTool(new DesktopMcpServer());
    expect(tool.name).toBe('bind-template');
    expect(tool.description).toContain('two-call binder');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      ask: expect.any(Object),
      proposal: expect.any(Object),
      minConfidence: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({
      title: 'Bind a Chart Template to an Ask (Fast Path)',
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

  return await callback({ session, ask, proposal, minConfidence, auto_apply }, extra);
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
  // Events-clean gate (W60): 0 = clean workbook (gate passes); N>0 = the user touched
  // the workbook between read and apply; 'unsupported' = executor without events
  // (gate is best-effort and must NOT block auto_apply).
  userEventsDuringBind = 0,
  // Staleness hash gate (W60 P1-6): the XML `getWorkbookXml` returns on its SECOND
  // call (the pre-apply rehash). Defaults to `XML` (unchanged workbook, gate passes).
  // Pass a different string to simulate a stale/edited workbook, or an Err(...) to
  // simulate the rehash read itself failing.
  workbookXmlOnRehash = Ok(XML) as Result<string, ExecuteCommandError>,
}: {
  bind?: BinderResult;
  fastPathEligible?: boolean;
  inject?: { ok: true; xml: string } | { ok: false; issues: string[] };
  validationValid?: boolean;
  dispatch?: ReturnType<typeof Ok> | ReturnType<typeof Err>;
  userEventsDuringBind?: number | 'unsupported';
  workbookXmlOnRehash?: Result<string, ExecuteCommandError>;
} = {}): {
  executeCommand: ReturnType<typeof vi.fn>;
  getEvents: ReturnType<typeof vi.fn>;
  getExecutor: ReturnType<typeof vi.fn>;
} {
  // 1st call: the original bind-time read. 2nd call (and beyond): the pre-apply
  // staleness rehash — independently variable so the hash-gate is testable without
  // breaking every existing test that assumes a single stable `Ok(XML)`.
  vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml')
    .mockResolvedValueOnce(Ok(XML))
    .mockResolvedValue(workbookXmlOnRehash);
  vi.mocked(binderModule.bindTemplate).mockResolvedValue(bind);
  vi.spyOn(bundledIntelligenceProvider, 'listTemplateManifests').mockReturnValue([
    { template: 'bar-basic', fast_path_eligible: fastPathEligible } as unknown as TemplateManifest,
  ]);
  vi.mocked(getTemplatePath).mockReturnValue('/mock-templates/bar-basic.xml');
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
    // Bound args stay intact for the client.
    expect(body.args.template_name).toBe('bar-basic');

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

  it('auto_apply=true NEVER applies a Call-2 proposal (used_llm) even with a fast-path manifest', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks({ bind: boundViaProposalResult });

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
    expect(body.applied).toBeUndefined();
    expect(buildInjectedWorkbookXml).not.toHaveBeenCalled();
    expect(executeCommand).not.toHaveBeenCalled();
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

describe('bindTemplateTool auto_apply — staleness hash gate (W60 P1-6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies when the workbook is unchanged between the read and the pre-apply rehash', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks({ workbookXmlOnRehash: Ok(XML) });
    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(body.applied).toBe(true);
    expect(executeCommand).toHaveBeenCalledTimes(1);
  });

  it('refuses to apply when the workbook XML differs at the pre-apply rehash (falls back, bind intact)', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks({
      workbookXmlOnRehash: Ok('<?xml version="1.0"?><workbook><edited-by-user/></workbook>'),
    });
    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(body.applied).toBe(false);
    expect(String(body.apply_error)).toMatch(/staleness hash mismatch/);
    expect(body.args).toBeDefined(); // the bind survives — agent can re-get and retry
    expect(executeCommand).not.toHaveBeenCalled(); // the apply dispatch was never sent
  });

  it('falls back gracefully when the pre-apply rehash read itself fails (no dispatch)', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks({
      workbookXmlOnRehash: Err({ type: 'command-timed-out', error: 'Timeout' }),
    });
    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(body.applied).toBe(false);
    expect(String(body.apply_error)).toMatch(/staleness re-check failed/);
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('does not block the Athena-transport happy path: no events support + unchanged workbook still applies', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks({
      userEventsDuringBind: 'unsupported',
      workbookXmlOnRehash: Ok(XML),
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

  it('is the ONLY staleness protection on a transport where the events-gate is a total no-op (W60 P1-6 direct regression)', async () => {
    const { executeCommand, getExecutor } = setupAutoApplyMocks({
      userEventsDuringBind: 'unsupported',
      workbookXmlOnRehash: Ok('<?xml version="1.0"?><workbook><edited-by-user/></workbook>'),
    });
    const result = await getToolResult({
      session: '1',
      ask: 'bar chart of Sales by Region',
      auto_apply: true,
      getExecutor,
    });
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(body.applied).toBe(false);
    expect(String(body.apply_error)).toMatch(/staleness hash mismatch/);
    expect(executeCommand).not.toHaveBeenCalled();
  });
});
