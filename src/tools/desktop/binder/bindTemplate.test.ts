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
import { getBindTemplateTool } from './bindTemplate.js';

// Auto-mock the live-read command. Partial-mock the binder core so the pure
// DERIVATION_* exports used to build the zod schema stay intact while only
// bindTemplate is stubbed. Stub loadManifests so the tool test is independent of
// the bundled manifest data (the binder library has its own coverage for both).
vi.mock('../../../desktop/commands/workbook/getWorkbookXml.js');
vi.mock('../../../desktop/binder/binder.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../desktop/binder/binder.js')>();
  return { ...actual, bindTemplate: vi.fn() };
});
vi.mock('../../../desktop/binder/manifest.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../desktop/binder/manifest.js')>();
  return { ...actual, loadManifests: vi.fn(() => new Map()) };
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

    // Escalate is a business outcome, NOT a tool error (a2td set isError=true;
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
});

async function getToolResult({
  session,
  ask,
  proposal,
  minConfidence,
  customSignal,
}: {
  session: string;
  ask: string;
  // The tool schema requires confidence even though the library type leaves it optional.
  proposal?: BindingProposal & { confidence: number };
  minConfidence?: number;
  customSignal?: AbortSignal;
}): Promise<CallToolResult> {
  const tool = getBindTemplateTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);

  const mockExecutor: TableauDesktopToolContext['getExecutor'] = vi.fn().mockResolvedValue({});
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: mockExecutor,
    ...(customSignal && { signal: customSignal }),
  };

  return await callback({ session, ask, proposal, minConfidence }, extra);
}
