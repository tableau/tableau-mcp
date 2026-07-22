import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import type { BinderResult } from '../../../desktop/binder/binder.js';
import * as binderModule from '../../../desktop/binder/binder.js';
import type { TemplateManifest } from '../../../desktop/binder/manifest-types.js';
import * as getWorkbookXmlModule from '../../../desktop/commands/workbook/getWorkbookXml.js';
import * as injectViewpointsModule from '../../../desktop/commands/workbook/injectViewpoints.js';
import * as externalDiscovery from '../../../desktop/externalApi/discovery.js';
import { bundledIntelligenceProvider } from '../../../desktop/intelligence/provider.js';
import * as xmlToJsonModule from '../../../desktop/libraries/workbook-serialization-converter/index.js';
import { normalizeArray, parseXML } from '../../../desktop/metadata/parser.js';
import type { ParsedWindow } from '../../../desktop/metadata/types.js';
import * as injectTemplateModule from '../../../desktop/templates/injectTemplate.js';
import { buildInjectedWorkbookXml } from '../../../desktop/templates/injectTemplateCore.js';
import { readTemplate } from '../../../desktop/templates/templatePath.js';
import * as validationRegistry from '../../../desktop/validation/registry.js';
import { NoDesktopInstancesFoundError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { DASHBOARD_ZONES_VIA_WORKBOOK, getDashboardAutoApplyTool } from './dashboardAutoApply.js';

// Auto-mock the live-read + inject/apply boundaries. Partial-mock binder.js and
// injectTemplateCore.js so their pure exports (escapeXml, DERIVATION_* etc.) stay real
// while only the impure/heavy entry points are stubbed — mirrors bindTemplate.test.ts.
vi.mock('../../../desktop/commands/workbook/getWorkbookXml.js');
vi.mock('../../../desktop/commands/workbook/injectViewpoints.js');
vi.mock('../../../desktop/templates/injectTemplate.js');
vi.mock('../../../desktop/binder/binder.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../desktop/binder/binder.js')>();
  return { ...actual, bindTemplate: vi.fn() };
});
vi.mock('../../../desktop/templates/injectTemplateCore.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../desktop/templates/injectTemplateCore.js')>();
  return { ...actual, buildInjectedWorkbookXml: vi.fn() };
});
vi.mock('../../../desktop/externalApi/discovery.js');
vi.mock('../../../desktop/libraries/workbook-serialization-converter/index.js');
vi.mock('../../../desktop/templates/templatePath.js');
vi.mock('../../../desktop/validation/registry.js');
// Partial fs mock: templates come from the mocked SEA-aware `readTemplate` seam
// (templatePath.js above); fs reads stay live for the real manifest/content loads
// and only writes are stubbed so no test touches disk.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: (actual as unknown as { default?: typeof actual }).default ?? actual,
    writeFileSync: vi.fn(),
  };
});

const XML = '<?xml version="1.0"?><workbook><windows></windows></workbook>';

function boundResultFor(templateName: string, title: string): BinderResult {
  return {
    status: 'bound',
    used_llm: false,
    apply_hint: 'worksheet-path',
    apply_instruction: 'Create a sheet, substitute the fragment, then apply-worksheet.',
    args: {
      template_name: templateName,
      title,
      sheet_type: 'worksheet',
      template_parameters: { DATASOURCE: 'Superstore' },
      field_mapping: { cat: '[Region]', val: '[Sales]' },
    },
  };
}

const boundA = boundResultFor('bar-basic', 'Sales by Region');
const boundB = boundResultFor('line-basic', 'Profit by Month');

const proposeResult: BinderResult = {
  status: 'propose',
  decline_reason: {
    code: 'no_llm_classifier_declined',
    detail: 'classifyNoLlm returned no deterministic template; routed to proposal candidates',
  },
  llm_input: { ask: 'weird ask', candidate_templates: [], fields: [] } as unknown as Extract<
    BinderResult,
    { status: 'propose' }
  >['llm_input'],
  output_schema: { type: 'object' },
};

const escalateResult: BinderResult = {
  status: 'escalate',
  reason: 'field-not-found',
  blockers: [{ code: 'field-not-found', slot_id: 'val', detail: 'No field named "Revenue".' }],
};

describe('dashboardAutoApplyTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(externalDiscovery.discoverInstances).mockReturnValue([]);
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getDashboardAutoApplyTool(new DesktopMcpServer());
    expect(tool.name).toBe('dashboard-auto-apply');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      asks: expect.any(Object),
      dashboardName: expect.any(Object),
      title: expect.any(Object),
      layout: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });

  it('the live probe verdict is PASS — one content-creation dispatch is the shipped default', () => {
    // W60 zones-live-probe (2026-07-08, session 18055): a fully zone-populated
    // dashboard node survived a single workbook-level apply on readback. Pin the
    // verdict so a future edit cannot silently flip back to fallback mode.
    expect(DASHBOARD_ZONES_VIA_WORKBOOK).toBe(true);
  });

  it('asks length 1 is refused at the schema layer', async () => {
    const tool = getDashboardAutoApplyTool(new DesktopMcpServer());
    const schema = z.object(await Provider.from(tool.paramsSchema));
    expect(
      schema.safeParse({
        asks: [{ ask: 'bar chart of Sales by Region' }],
        dashboardName: 'D',
      }).success,
    ).toBe(false);
  });

  it('asks length 7 is refused at the schema layer', async () => {
    const tool = getDashboardAutoApplyTool(new DesktopMcpServer());
    const schema = z.object(await Provider.from(tool.paramsSchema));
    const asks = Array.from({ length: 7 }, (_, i) => ({ ask: `chart ${i}` }));
    expect(schema.safeParse({ asks, dashboardName: 'D' }).success).toBe(false);
  });

  it('asks length 2 and 6 are accepted at the schema layer', async () => {
    const tool = getDashboardAutoApplyTool(new DesktopMcpServer());
    const schema = z.object(await Provider.from(tool.paramsSchema));
    expect(
      schema.safeParse({ asks: [{ ask: 'a' }, { ask: 'b' }], dashboardName: 'D' }).success,
    ).toBe(true);
    const six = Array.from({ length: 6 }, (_, i) => ({ ask: `chart ${i}` }));
    expect(schema.safeParse({ asks: six, dashboardName: 'D' }).success).toBe(true);
  });
});

/**
 * Wire the happy-path seams for a dashboard-auto-apply call over `binds` (default 2
 * asks). Mirrors bindTemplate.test.ts's setupAutoApplyMocks: the apply leg runs the
 * REAL validated `loadWorkbookXml` path (real runValidation via a mocked registry
 * result, real executor dispatch) so preflight is never bypassed; only the boundaries
 * (read, bind, inject-core, template path, dashboard/viewpoint injectors) are mocked.
 */
function setupMocks({
  binds = [boundA, boundB],
  fastPathEligible = true,
  inject = { ok: true as const, xml: XML },
  validationValid = true,
  dispatch = Ok({ command_id: 'cmd-1', status: 'completed', submitted_at: '', result: {} }),
  userEventsDuringBatch = 0,
  existingDashboards = [] as string[],
}: {
  binds?: BinderResult[];
  fastPathEligible?: boolean;
  inject?: { ok: true; xml: string } | { ok: false; issues: string[] };
  validationValid?: boolean;
  dispatch?: ReturnType<typeof Ok> | ReturnType<typeof Err>;
  userEventsDuringBatch?: number | 'unsupported';
  existingDashboards?: string[];
} = {}): {
  executeCommand: ReturnType<typeof vi.fn>;
  applyWorkbookDocument: ReturnType<typeof vi.fn>;
  getEvents: ReturnType<typeof vi.fn>;
  getExecutor: ReturnType<typeof vi.fn>;
  bindSpy: ReturnType<typeof vi.fn>;
} {
  const dashboardsXml = existingDashboards
    .map((n) => `<dashboard name="${n}"><zones/></dashboard>`)
    .join('');
  const workbookXml = `<?xml version="1.0"?><workbook><dashboards>${dashboardsXml}</dashboards><windows></windows></workbook>`;

  let liveXml = workbookXml;
  vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockImplementation(async () => Ok(liveXml));
  const bindSpy = vi.mocked(binderModule.bindTemplate);
  let call = 0;
  bindSpy.mockImplementation(async () => binds[call++ % binds.length]);

  const templateNames = [
    ...new Set(binds.filter((b) => b.status === 'bound').map((b) => b.args.template_name)),
  ];
  vi.spyOn(bundledIntelligenceProvider, 'listTemplateManifests').mockReturnValue(
    templateNames.map(
      (template) =>
        ({ template, fast_path_eligible: fastPathEligible }) as unknown as TemplateManifest,
    ),
  );
  vi.mocked(readTemplate).mockReturnValue('<template/>');
  vi.mocked(buildInjectedWorkbookXml).mockReturnValue(inject);
  vi.mocked(injectTemplateModule.injectTemplate).mockImplementation(
    (wb: string) => wb, // pass currentXml through unchanged; the wrapper content is asserted via the spy call args
  );
  vi.spyOn(injectViewpointsModule, 'injectViewpoints').mockImplementation((wb: string) => wb);

  vi.mocked(xmlToJsonModule.xmlToJson).mockImplementation(() => {
    throw new Error('force text path');
  });
  vi.mocked(validationRegistry.runValidation).mockReturnValue(
    validationValid
      ? { valid: true, issues: [] }
      : { valid: false, issues: [{ ruleId: 'r', severity: 'error', message: 'boom' }] },
  );

  const executeCommand = vi.fn().mockResolvedValue(dispatch);
  const applyWorkbookDocument = vi.fn(async (xml: string) => {
    if (dispatch.isOk()) {
      liveXml = xml;
    }
    return dispatch;
  });
  const getEvents =
    userEventsDuringBatch === 'unsupported'
      ? vi.fn().mockResolvedValue(Err('events unsupported on this transport'))
      : vi
          .fn()
          .mockResolvedValueOnce(Ok({ events: [], latest_sequence: 41, count: 0 }))
          .mockResolvedValue(
            Ok({
              events: Array.from({ length: userEventsDuringBatch as number }, (_, i) => ({
                id: i,
              })),
              latest_sequence: 41 + (userEventsDuringBatch as number),
              count: userEventsDuringBatch,
            }),
          );
  const getExecutor = vi.fn().mockResolvedValue({
    executeCommand,
    applyWorkbookDocument,
    getEvents,
  });
  return { executeCommand, applyWorkbookDocument, getEvents, getExecutor, bindSpy };
}

async function getToolResult({
  session,
  asks,
  dashboardName = 'Sales Dashboard',
  title,
  getExecutor,
}: {
  session?: string;
  asks: Array<{ ask: string; title?: string }>;
  dashboardName?: string;
  title?: string;
  getExecutor?: TableauDesktopToolContext['getExecutor'];
}): Promise<CallToolResult> {
  const tool = getDashboardAutoApplyTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const mockExecutor: TableauDesktopToolContext['getExecutor'] =
    getExecutor ?? vi.fn().mockResolvedValue({});
  const extra = { ...getMockRequestHandlerExtra(), getExecutor: mockExecutor };
  return await callback({ session, asks, dashboardName, title, layout: undefined }, extra);
}

describe('dashboardAutoApplyTool happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(externalDiscovery.discoverInstances).mockReturnValue([]);
  });

  it('keeps the internal sheet build focus-neutral and returns the trimmed success shape', async () => {
    const { applyWorkbookDocument, getExecutor } = setupMocks();

    const result = await getToolResult({
      session: '1',
      asks: [{ ask: 'bar chart of Sales by Region' }, { ask: 'line chart of Profit by Month' }],
      getExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(true);
    expect(body.dashboard).toBe('Sales Dashboard');
    expect(body.sheets).toEqual([
      { title: 'Sales by Region', template_name: 'bar-basic' },
      { title: 'Profit by Month', template_name: 'line-basic' },
    ]);
    expect(typeof body.phase_ms.read).toBe('number');
    expect(typeof body.phase_ms.bind).toBe('number');
    expect(typeof body.phase_ms.inject).toBe('number');
    expect(typeof body.phase_ms.apply).toBe('number');
    expect(Object.keys(body).sort()).toEqual([
      'applied',
      'dashboard',
      'guidance',
      'phase_ms',
      'sheets',
    ]);

    // The public dashboard boundary performs the one primary read plus the bounded
    // not-found activation revalidation; internal worksheets never activate independently.
    expect(vi.mocked(getWorkbookXmlModule.getWorkbookXml)).toHaveBeenCalledTimes(3);
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
  });

  it('activates the composed dashboard once through validated goto-sheet', async () => {
    const injectedWorkbook = `<?xml version="1.0"?><workbook>
      <worksheets><worksheet name="Old Sheet"><table /></worksheet></worksheets>
      <dashboards></dashboards>
      <windows><window class="worksheet" name="Old Sheet" active="true" maximized="true" /></windows>
    </workbook>`;
    const { executeCommand, applyWorkbookDocument, getExecutor } = setupMocks({
      inject: { ok: true, xml: injectedWorkbook },
    });
    vi.mocked(injectTemplateModule.injectTemplate).mockImplementation((workbookXml: string) => {
      return workbookXml
        .replace(
          '</dashboards>',
          '<dashboard name="Sales Dashboard"><zones/></dashboard></dashboards>',
        )
        .replace('</windows>', '<window class="dashboard" name="Sales Dashboard" /></windows>');
    });

    const result = await getToolResult({
      session: '1',
      asks: [{ ask: 'bar chart of Sales by Region' }, { ask: 'line chart of Profit by Month' }],
      getExecutor,
    });

    expect(result.isError).toBe(false);
    const [primaryXml] = applyWorkbookDocument.mock.calls[0] ?? [];
    const primaryWindows = normalizeArray<ParsedWindow>(
      parseXML(String(primaryXml)).workbook?.windows?.window,
    );
    expect(primaryWindows.find((window) => window['@_name'] === 'Old Sheet')).toMatchObject({
      '@_active': 'true',
      '@_maximized': 'true',
    });
    expect(
      primaryWindows.find((window) => window['@_name'] === 'Sales Dashboard'),
    ).not.toMatchObject({
      '@_active': 'true',
      '@_maximized': 'true',
    });
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
    expect(executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'tabdoc',
        command: 'goto-sheet',
        args: { Sheet: 'Sales Dashboard' },
      }),
    );
  });

  it('injects the dashboard wrapper with zones referencing every resolved title', async () => {
    const { getExecutor } = setupMocks();

    await getToolResult({
      session: '1',
      asks: [{ ask: 'bar chart of Sales by Region' }, { ask: 'line chart of Profit by Month' }],
      title: 'My Dashboard',
      getExecutor,
    });

    expect(injectTemplateModule.injectTemplate).toHaveBeenCalledTimes(1);
    const [, wrapperXml, sheetType] = vi.mocked(injectTemplateModule.injectTemplate).mock.calls[0];
    expect(sheetType).toBe('dashboard');
    expect(wrapperXml).toContain('<zone');
    expect(wrapperXml).toContain('name="Sales by Region"');
    expect(wrapperXml).toContain('name="Profit by Month"');
    expect(wrapperXml).toContain('type-v2="text"'); // title zone present

    expect(injectViewpointsModule.injectViewpoints).toHaveBeenCalledWith(
      expect.any(String),
      'Sales Dashboard',
      ['Sales by Region', 'Profit by Month'],
    );
  });

  it('honors a per-ask title override in the resolved zone/viewpoint titles', async () => {
    const { getExecutor } = setupMocks();

    await getToolResult({
      session: '1',
      asks: [
        { ask: 'bar chart of Sales by Region', title: 'Custom A' },
        { ask: 'line chart of Profit by Month' },
      ],
      getExecutor,
    });

    expect(injectViewpointsModule.injectViewpoints).toHaveBeenCalledWith(
      expect.any(String),
      'Sales Dashboard',
      ['Custom A', 'Profit by Month'],
    );
  });

  it('pristine-read regression: every ask is bound against the IDENTICAL pristine workbookXml', async () => {
    const { getExecutor, bindSpy } = setupMocks();

    await getToolResult({
      session: '1',
      asks: [{ ask: 'bar chart of Sales by Region' }, { ask: 'line chart of Profit by Month' }],
      getExecutor,
    });

    expect(bindSpy).toHaveBeenCalledTimes(2);
    const xmls = bindSpy.mock.calls.map((c) => (c[0] as { workbookXml: string }).workbookXml);
    expect(xmls[0]).toBe(xmls[1]);
    expect(xmls[0]).toContain('<workbook>');
  });

  it('runs preflight validation BEFORE dispatching the apply', async () => {
    const { applyWorkbookDocument, getExecutor } = setupMocks();

    await getToolResult({
      session: '1',
      asks: [{ ask: 'bar chart of Sales by Region' }, { ask: 'line chart of Profit by Month' }],
      getExecutor,
    });

    expect(validationRegistry.runValidation).toHaveBeenCalledTimes(1);
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
    const validationOrder = vi.mocked(validationRegistry.runValidation).mock.invocationCallOrder[0];
    const dispatchOrder = applyWorkbookDocument.mock.invocationCallOrder[0];
    expect(validationOrder).toBeLessThan(dispatchOrder);
  });

  it('replaces a pre-existing same-named dashboard and reports it in `replaced`', async () => {
    const { getExecutor } = setupMocks({ existingDashboards: ['Sales Dashboard'] });

    const result = await getToolResult({
      session: '1',
      asks: [{ ask: 'bar chart of Sales by Region' }, { ask: 'line chart of Profit by Month' }],
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(true);
    expect(body.replaced).toEqual({ dashboard: 'Sales Dashboard', sheets: [] });
  });
});

describe('dashboardAutoApplyTool all-or-nothing gate matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(externalDiscovery.discoverInstances).mockReturnValue([]);
  });

  it('any ask "propose" refuses the whole batch — zero dispatches, every outcome intact', async () => {
    const { applyWorkbookDocument, getExecutor } = setupMocks({ binds: [boundA, proposeResult] });

    const result = await getToolResult({
      session: '1',
      asks: [{ ask: 'bar chart of Sales by Region' }, { ask: 'something weird' }],
      getExecutor,
    });

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(false);
    expect(body.results).toHaveLength(2);
    expect(body.results[0].result.status).toBe('bound');
    expect(body.results[1].result.status).toBe('propose');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('any ask "escalate" refuses the whole batch — zero dispatches', async () => {
    const { applyWorkbookDocument, getExecutor } = setupMocks({ binds: [boundA, escalateResult] });

    const result = await getToolResult({
      session: '1',
      asks: [{ ask: 'bar chart of Sales by Region' }, { ask: 'weird revenue ask' }],
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const expectedBody = {
      applied: false,
      results: [
        { index: 0, ask: 'bar chart of Sales by Region', result: boundA },
        { index: 1, ask: 'weird revenue ask', result: escalateResult },
      ],
      guidance:
        'One or more asks did not deterministically bind (Call-1, no-LLM). Nothing was applied to ' +
        'the live workbook. Each ask carries its own bind-template-shaped outcome below: for ' +
        '"propose", fill its output_schema and call bind-template again; for "escalate", follow its ' +
        'guidance. Once every ask binds, retry dashboard-auto-apply, or fall back to the per-viz ' +
        'bind-template(auto_apply:true) flow using each already-bound ask.',
    };
    expect(result.content[0].text).toBe(JSON.stringify(expectedBody));
    expect(result.structuredContent).toEqual({
      nextAction: { label: 'Resolve each ask before retrying', kind: 'prefill' },
    });
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(false);
    expect(body.results[1].result.reason).toBe('field-not-found');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('mutation-proof: a bound-but-used_llm:true result (impossible via Call-1, simulated via mock) refuses the batch', async () => {
    const usedLlmBound: BinderResult = {
      ...(boundA as Extract<BinderResult, { status: 'bound' }>),
      used_llm: true,
    };
    const { applyWorkbookDocument, getExecutor } = setupMocks({ binds: [usedLlmBound, boundB] });

    const result = await getToolResult({
      session: '1',
      asks: [{ ask: 'bar chart of Sales by Region' }, { ask: 'line chart of Profit by Month' }],
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(false);
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('mutation-proof: a bound result whose manifest is not fast_path_eligible refuses the batch', async () => {
    const { applyWorkbookDocument, getExecutor } = setupMocks({ fastPathEligible: false });

    const result = await getToolResult({
      session: '1',
      asks: [{ ask: 'bar chart of Sales by Region' }, { ask: 'line chart of Profit by Month' }],
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(false);
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('events-dirty pre-dispatch refuses the whole batch with P1-5 guidance, zero dispatches', async () => {
    const { applyWorkbookDocument, getExecutor } = setupMocks({ userEventsDuringBatch: 3 });

    const result = await getToolResult({
      session: '1',
      asks: [{ ask: 'bar chart of Sales by Region' }, { ask: 'line chart of Profit by Month' }],
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(false);
    expect(String(body.apply_error)).toMatch(/user changed the workbook.*3 event/);
    expect(String(body.guidance)).toMatch(/re-run dashboard-auto-apply/i);
    expect(result.structuredContent).toEqual({
      nextAction: { label: 'Re-run dashboard-auto-apply', kind: 'prefill' },
    });
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('gate is best-effort: an executor without event support still applies', async () => {
    const { applyWorkbookDocument, getExecutor } = setupMocks({
      userEventsDuringBatch: 'unsupported',
    });

    const result = await getToolResult({
      session: '1',
      asks: [{ ask: 'bar chart of Sales by Region' }, { ask: 'line chart of Profit by Month' }],
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(true);
    expect(applyWorkbookDocument).toHaveBeenCalled();
  });

  it('inject failure on ask 2 of 2 refuses the whole batch — zero dispatches, diagnostics intact', async () => {
    const { applyWorkbookDocument, getExecutor } = setupMocks({
      inject: { ok: false, issues: ['not well-formed'] },
    });

    const result = await getToolResult({
      session: '1',
      asks: [{ ask: 'bar chart of Sales by Region' }, { ask: 'line chart of Profit by Month' }],
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(false);
    expect(String(body.apply_error)).toContain('inject failed');
    expect(body.results).toHaveLength(2);
    expect(body.results[0].result.status).toBe('bound');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('preflight validation failure aborts the apply — zero dispatches', async () => {
    const { applyWorkbookDocument, getExecutor } = setupMocks({ validationValid: false });

    const result = await getToolResult({
      session: '1',
      asks: [{ ask: 'bar chart of Sales by Region' }, { ask: 'line chart of Profit by Month' }],
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(false);
    expect(String(body.apply_error)).toContain('preflight validation failed');
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('duplicate resolved titles within the batch refuse — zero dispatches, indices named', async () => {
    const dup = boundResultFor('bar-basic', 'Same Title');
    const dup2 = boundResultFor('line-basic', 'Same Title');
    const { applyWorkbookDocument, getExecutor } = setupMocks({ binds: [dup, dup2] });

    const result = await getToolResult({
      session: '1',
      asks: [{ ask: 'bar chart' }, { ask: 'line chart' }],
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(false);
    expect(String(body.guidance)).toMatch(/Duplicate resolved title/);
    expect(String(body.guidance)).toMatch(/\[0, 1\]/);
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('a title referenced by an existing dashboard zone refuses — zero dispatches', async () => {
    const { applyWorkbookDocument, getExecutor } = setupMocks();
    // A DIFFERENT existing dashboard's zone already references "Sales by Region".
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(
      Ok(
        '<?xml version="1.0"?><workbook><dashboards><dashboard name="Other"><zones><zone name="Sales by Region"/></zones></dashboard></dashboards><windows></windows></workbook>',
      ),
    );

    const result = await getToolResult({
      session: '1',
      asks: [{ ask: 'bar chart of Sales by Region' }, { ask: 'line chart of Profit by Month' }],
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(false);
    expect(String(body.apply_error)).toMatch(/referenced by existing dashboard zone/);
    expect(applyWorkbookDocument).not.toHaveBeenCalled();
  });

  it('replacing the SAME-named dashboard does not self-collide with the zone-reference guard', async () => {
    // The dashboard we are about to replace references "Sales by Region" itself — that
    // must NOT trip the "referenced by an existing dashboard" refusal (Q1).
    const { applyWorkbookDocument, getExecutor } = setupMocks({
      existingDashboards: ['Sales Dashboard'],
    });
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(
      Ok(
        '<?xml version="1.0"?><workbook><dashboards><dashboard name="Sales Dashboard"><zones><zone name="Sales by Region"/></zones></dashboard></dashboards><windows></windows></workbook>',
      ),
    );

    const result = await getToolResult({
      session: '1',
      asks: [{ ask: 'bar chart of Sales by Region' }, { ask: 'line chart of Profit by Month' }],
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(true);
    expect(applyWorkbookDocument).toHaveBeenCalledTimes(1);
  });

  it('a resolved title matching an already-existing worksheet is reported as replaced', async () => {
    const { getExecutor } = setupMocks();
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(
      Ok(
        '<?xml version="1.0"?><workbook><worksheets><worksheet name="Sales by Region"></worksheet></worksheets><dashboards></dashboards><windows></windows></workbook>',
      ),
    );

    const result = await getToolResult({
      session: '1',
      asks: [{ ask: 'bar chart of Sales by Region' }, { ask: 'line chart of Profit by Month' }],
      getExecutor,
    });

    invariant(result.content[0].type === 'text');
    const body = JSON.parse(result.content[0].text);
    expect(body.applied).toBe(true);
    expect(body.replaced.sheets).toEqual(['Sales by Region']);
  });
});

describe('dashboardAutoApplyTool session-default-when-unique', () => {
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
    const { getExecutor } = setupMocks();

    const result = await getToolResult({
      asks: [{ ask: 'bar chart of Sales by Region' }, { ask: 'line chart of Profit by Month' }],
      getExecutor,
    });

    expect(result.isError).toBe(false);
    expect(getExecutor).toHaveBeenCalledWith('4242');
  });

  it('fails closed listing instances when 2+ Desktop instances are running (no read, no bind)', async () => {
    mockInstances([11, 22]);
    const getExecutor = vi.fn().mockResolvedValue({});
    const getWorkbookXmlSpy = vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml');

    const result = await getToolResult({
      asks: [{ ask: 'bar chart of Sales by Region' }, { ask: 'line chart of Profit by Month' }],
      getExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Multiple Tableau Desktop instances are running');
    expect(getExecutor).not.toHaveBeenCalled();
    expect(getWorkbookXmlSpy).not.toHaveBeenCalled();
  });

  it('fails closed when no Desktop instance is running', async () => {
    mockInstances([]);
    const getExecutor = vi.fn().mockResolvedValue({});

    const result = await getToolResult({
      asks: [{ ask: 'bar chart of Sales by Region' }, { ask: 'line chart of Profit by Month' }],
      getExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new NoDesktopInstancesFoundError().message);
    expect(getExecutor).not.toHaveBeenCalled();
  });

  it('targets an explicit session that is one of the running instances', async () => {
    mockInstances([11, 22]);
    const { getExecutor } = setupMocks();

    const result = await getToolResult({
      session: '22',
      asks: [{ ask: 'bar chart of Sales by Region' }, { ask: 'line chart of Profit by Month' }],
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
      asks: [{ ask: 'bar chart of Sales by Region' }, { ask: 'line chart of Profit by Month' }],
      getExecutor,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('7');
    expect(result.content[0].text).toContain('list-instances');
    expect(getExecutor).not.toHaveBeenCalled();
  });
});
