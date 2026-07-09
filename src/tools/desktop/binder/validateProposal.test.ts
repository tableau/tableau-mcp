import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import type { BinderResult, BindingProposal } from '../../../desktop/binder/binder.js';
import * as binderModule from '../../../desktop/binder/binder.js';
import * as getWorkbookXmlModule from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getValidateProposalTool } from './validateProposal.js';

// Auto-mock the live-read command. Partial-mock the binder core so only bindTemplate is
// stubbed — validate-proposal delegates its verdict to the SAME bindTemplate() bind-template
// uses on Call 2, so the tool test controls that outcome and asserts the wiring. The bundled
// provider is exercised for REAL (data ships in-repo, hermetic).
vi.mock('../../../desktop/commands/workbook/getWorkbookXml.js');
vi.mock('../../../desktop/binder/binder.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../desktop/binder/binder.js')>();
  return { ...actual, bindTemplate: vi.fn() };
});

const XML = '<?xml version="1.0"?><workbook></workbook>';

const boundResult: BinderResult = {
  status: 'bound',
  used_llm: true,
  apply_hint: 'worksheet-path',
  apply_instruction: 'Create a sheet, substitute the fragment, then apply-worksheet.',
  args: {
    template_name: 'ranking-ordered-bar',
    title: 'Sales by Region',
    sheet_type: 'worksheet',
    template_parameters: { DATASOURCE: 'Superstore' },
    field_mapping: { cat: '[Region]', val: '[Sales]' },
  },
};

const escalateResult: BinderResult = {
  status: 'escalate',
  reason: 'field-not-found',
  blockers: [{ code: 'field-not-found', slot_id: 'val', detail: 'No field named "Revenue".' }],
};

const proposeResult: BinderResult = {
  status: 'propose',
  llm_input: {
    ask: 'x',
    candidate_templates: [],
    fields: [],
  } as unknown as Extract<BinderResult, { status: 'propose' }>['llm_input'],
  output_schema: { type: 'object' },
};

const sampleProposal: BindingProposal & { confidence: number } = {
  template: 'ranking-ordered-bar',
  title: 'Sales by Region',
  bindings: [
    { slot_id: 'cat', field: 'Region' },
    { slot_id: 'val', field: 'Sales' },
  ],
  confidence: 0.9,
};

describe('validateProposalTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getValidateProposalTool(new DesktopMcpServer());
    expect(tool.name).toBe('validate-proposal');
    expect(tool.description).toContain('Dry-run');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      ask: expect.any(Object),
      proposal: expect.any(Object),
      minConfidence: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({
      title: 'Validate a Binding Proposal (Dry Run)',
      readOnlyHint: true,
      openWorldHint: false,
    });
  });

  it('returns valid:true with the would-be inject args when the proposal passes the gate', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(boundResult);

    const body = await getBody({ session: '1', ask: 'bar chart', proposal: sampleProposal });

    expect(body.valid).toBe(true);
    expect(body.args?.template_name).toBe('ranking-ordered-bar');
    expect(body.content_status.freshness).toBe('bundled-snapshot');
    expect(body.guidance).toContain('VALID');
    expect(body.guidance).toContain('dry run');
    // Nothing about applying happened here — no reason/blockers on a valid result.
    expect(body.reason).toBeUndefined();
    expect(body.blockers).toBeUndefined();
  });

  it('returns valid:false with the reason + structured blockers when the proposal fails the gate', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(escalateResult);

    const body = await getBody({ session: '1', ask: 'bar chart', proposal: sampleProposal });

    expect(body.valid).toBe(false);
    expect(body.reason).toBe('field-not-found');
    expect(body.blockers).toHaveLength(1);
    expect(body.guidance).toContain('INVALID');
    expect(body.args).toBeUndefined();
  });

  it('passes the proposal, minConfidence, and live workbook XML to the binder (Call-2 validate)', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(boundResult);

    await getBody({ session: '1', ask: 'bar chart', proposal: sampleProposal, minConfidence: 0.8 });

    expect(binderModule.bindTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        ask: 'bar chart',
        workbookXml: XML,
        proposal: sampleProposal,
        minConfidence: 0.8,
      }),
    );
  });

  it('funnels a workbook-read failure through the McpToolError path (isError true) and never validates', async () => {
    const error = { type: 'unknown' as const, error: new Error('Network error') };
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Err(error));

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart',
      proposal: sampleProposal,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error).message);
    expect(binderModule.bindTemplate).not.toHaveBeenCalled();
  });

  it('fails closed if the binder ever returns "propose" for a filled proposal', async () => {
    // A filled proposal always drives bindTemplate down the Call-2 validate path, so
    // "propose" is unreachable; if the contract ever changes the tool must NOT silently
    // report the proposal as valid — it throws, funneling through the McpToolError path.
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(proposeResult);

    const result = await getToolResult({
      session: '1',
      ask: 'bar chart',
      proposal: sampleProposal,
    });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('unexpected status');
  });

  it('passes the abort signal to the workbook read', async () => {
    const spy = vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.bindTemplate).mockResolvedValue(boundResult);
    const customSignal = new AbortController().signal;

    await getToolResult({ session: '1', ask: 'bar chart', proposal: sampleProposal, customSignal });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ signal: customSignal }));
  });

  it('REQUIRES a proposal at the schema layer (fail-closed watch-class guard)', async () => {
    // bind-template makes proposal optional (Call-1 vs Call-2); validate-proposal has one
    // job, so an omitted proposal must be rejected — otherwise it would silently classify
    // instead of validate (fail-open).
    const tool = getValidateProposalTool(new DesktopMcpServer());
    const schema = z.object(await Provider.from(tool.paramsSchema));
    expect(schema.safeParse({ session: '1', ask: 'bar chart' }).success).toBe(false);
    expect(
      schema.safeParse({ session: '1', ask: 'bar chart', proposal: sampleProposal }).success,
    ).toBe(true);
  });

  it('inherits the tightened proposal contract: confidence required, title <= 80', async () => {
    const tool = getValidateProposalTool(new DesktopMcpServer());
    const schema = z.object(await Provider.from(tool.paramsSchema));
    const { confidence: _omitted, ...noConfidence } = sampleProposal;
    expect(
      schema.safeParse({ session: '1', ask: 'bar chart', proposal: noConfidence }).success,
    ).toBe(false);
    const longTitle = { ...sampleProposal, title: 'x'.repeat(81) };
    expect(schema.safeParse({ session: '1', ask: 'bar chart', proposal: longTitle }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ session: '1', ask: 'bar chart', proposal: sampleProposal }).success,
    ).toBe(true);
  });
});

interface ValidateBody {
  valid: boolean;
  content_status: { freshness: string; satisfies_exec_freshness: boolean };
  args?: { template_name: string };
  warnings?: string[];
  reason?: string;
  blockers?: Array<{ code: string; slot_id?: string; detail: string }>;
  guidance: string;
}

async function getBody(args: {
  session: string;
  ask: string;
  proposal: BindingProposal & { confidence: number };
  minConfidence?: number;
  customSignal?: AbortSignal;
}): Promise<ValidateBody> {
  const result = await getToolResult(args);
  expect(result.isError).toBe(false);
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}

async function getToolResult({
  session,
  ask,
  proposal,
  minConfidence,
  customSignal,
}: {
  session: string;
  ask: string;
  proposal: BindingProposal & { confidence: number };
  minConfidence?: number;
  customSignal?: AbortSignal;
}): Promise<CallToolResult> {
  const tool = getValidateProposalTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);

  const mockExecutor: TableauDesktopToolContext['getExecutor'] = vi.fn().mockResolvedValue({});
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: mockExecutor,
    ...(customSignal && { signal: customSignal }),
  };

  return await callback({ session, ask, proposal, minConfidence }, extra);
}
