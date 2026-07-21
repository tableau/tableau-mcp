import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import type { LlmProposeInput, SchemaSummary } from '../../../desktop/binder/binder.js';
import * as binderModule from '../../../desktop/binder/binder.js';
import * as getWorkbookXmlModule from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { TableauDesktopToolContext } from '../toolContext.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getProposeTemplateTool } from './proposeTemplate.js';

// Auto-mock the live-read command. Partial-mock the binder core so PROPOSAL_OUTPUT_SCHEMA
// (returned verbatim by the tool) stays intact while the three pure classify functions the
// tool orchestrates are stubbed — the binder library has its own coverage for their logic.
// The bundled provider is exercised for REAL (data ships in-repo, hermetic).
vi.mock('../../../desktop/commands/workbook/getWorkbookXml.js');
vi.mock('../../../desktop/binder/binder.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../desktop/binder/binder.js')>();
  return {
    ...actual,
    summarizeSchema: vi.fn(),
    classifyNoLlm: vi.fn(),
    buildLlmInput: vi.fn(),
  };
});

const XML = '<?xml version="1.0"?><workbook></workbook>';

const summary: SchemaSummary = { datasource: 'Superstore', fields: [] };

const llmInput: LlmProposeInput = {
  ask: 'bar chart of Sales by Region',
  candidate_templates: [
    {
      template: 'ranking-ordered-bar',
      description: 'A sorted bar chart for ranking.',
      intent_keywords: ['bar', 'ranking'],
      slots: [{ slot_id: 'cat', role: ['dimension'], kind: 'categorical', required: true }],
    },
  ],
  fields: [{ name: 'Region', role: 'dimension', type: 'nominal', datatype: 'string' }],
};

const noLlmMatch = {
  template: 'ranking-ordered-bar',
  bindings: [
    { slot_id: 'cat', field: 'Region' },
    { slot_id: 'val', field: 'Sales' },
  ],
};

describe('proposeTemplateTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getProposeTemplateTool(new DesktopMcpServer());
    expect(tool.name).toBe('propose-template');
    expect(tool.description).toBe('Classify template candidates.');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      ask: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({
      title: 'Propose Chart Template Candidates for an Ask',
      readOnlyHint: true,
      openWorldHint: false,
    });
  });

  it('returns status "propose" with candidate templates + output_schema when there is no no-LLM match', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.summarizeSchema).mockReturnValue(summary);
    vi.mocked(binderModule.classifyNoLlm).mockReturnValue(null);
    vi.mocked(binderModule.buildLlmInput).mockReturnValue(llmInput);

    const body = await getBody({ session: '1', ask: 'something ambiguous' });

    expect(body.status).toBe('propose');
    expect(body.no_llm_match).toBeUndefined();
    expect(body.llm_input).toEqual(llmInput);
    // Freshness is surfaced honestly through the provider seam.
    expect(body.content_status.freshness).toBe('bundled-snapshot');
    expect(body.content_status.satisfies_exec_freshness).toBe(false);
    expect(body.guidance).toContain('output_schema');
    // The classifier ran against a provider-sourced manifest Map, not a raw loader.
    expect(binderModule.buildLlmInput).toHaveBeenCalledWith(
      'something ambiguous',
      expect.any(Map),
      summary,
    );
    expect(binderModule.classifyNoLlm).toHaveBeenCalledWith(
      'something ambiguous',
      expect.any(Map),
      summary,
    );
  });

  it('returns status "deterministic" carrying the no_llm_match when the classifier finds one', async () => {
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.summarizeSchema).mockReturnValue(summary);
    vi.mocked(binderModule.classifyNoLlm).mockReturnValue(noLlmMatch);
    vi.mocked(binderModule.buildLlmInput).mockReturnValue(llmInput);

    const body = await getBody({ session: '1', ask: 'bar chart of Sales by Region' });

    expect(body.status).toBe('deterministic');
    expect(body.no_llm_match).toEqual(noLlmMatch);
    expect(body.llm_input).toEqual(llmInput);
    expect(body.guidance).toContain('no_llm_match');
  });

  it('surfaces the tightened proposal contract in output_schema (confidence required, title <= 80)', async () => {
    // propose-template ELICITS the hardened contract: the output_schema it returns is the
    // library's PROPOSAL_OUTPUT_SCHEMA, which requires confidence (the low-confidence floor
    // is skipped when confidence is undefined) and caps title at 80.
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.summarizeSchema).mockReturnValue(summary);
    vi.mocked(binderModule.classifyNoLlm).mockReturnValue(null);
    vi.mocked(binderModule.buildLlmInput).mockReturnValue(llmInput);

    const body = await getBody({ session: '1', ask: 'anything' });
    const schema = body.output_schema as {
      required: string[];
      properties: { title: { maxLength: number } };
    };
    expect(schema.required).toContain('confidence');
    expect(schema.required).toContain('title');
    expect(schema.properties.title.maxLength).toBe(80);
  });

  it('funnels a workbook-read failure through the McpToolError path (isError true) and never classifies', async () => {
    const error = { type: 'unknown' as const, error: new Error('Network error') };
    vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Err(error));

    const result = await getToolResult({ session: '1', ask: 'bar chart' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error).message);
    expect(binderModule.classifyNoLlm).not.toHaveBeenCalled();
    expect(binderModule.buildLlmInput).not.toHaveBeenCalled();
  });

  it('passes the abort signal to the workbook read', async () => {
    const spy = vi.spyOn(getWorkbookXmlModule, 'getWorkbookXml').mockResolvedValue(Ok(XML));
    vi.mocked(binderModule.summarizeSchema).mockReturnValue(summary);
    vi.mocked(binderModule.classifyNoLlm).mockReturnValue(null);
    vi.mocked(binderModule.buildLlmInput).mockReturnValue(llmInput);
    const customSignal = new AbortController().signal;

    await getToolResult({ session: '1', ask: 'bar chart', customSignal });

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ signal: customSignal }));
  });
});

interface ProposeBody {
  status: string;
  content_status: { freshness: string; satisfies_exec_freshness: boolean };
  no_llm_match?: { template: string; bindings: Array<{ slot_id: string; field: string }> };
  llm_input: LlmProposeInput;
  output_schema: unknown;
  guidance: string;
}

async function getBody(args: {
  session: string;
  ask: string;
  customSignal?: AbortSignal;
}): Promise<ProposeBody> {
  const result = await getToolResult(args);
  expect(result.isError).toBe(false);
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}

async function getToolResult({
  session,
  ask,
  customSignal,
}: {
  session: string;
  ask: string;
  customSignal?: AbortSignal;
}): Promise<CallToolResult> {
  const tool = getProposeTemplateTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);

  const mockExecutor: TableauDesktopToolContext['getExecutor'] = vi.fn().mockResolvedValue({});
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: mockExecutor,
    ...(customSignal && { signal: customSignal }),
  };

  return await callback({ session, ask }, extra);
}
