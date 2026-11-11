import { MCPServerStdio, run, StreamedRunResult, withTrace } from '@openai/agents';
import dotenv from 'dotenv';

import { getDefaultEnv, resetEnv, setEnv } from '../testEnv.js';
import { getAgent, getMcpServer, getModel, getToolExecutions } from './base.js';

dotenv.config({ path: 'tests/eval/.env' });

/**
 * Tool-selection evals for the CABU (Tableau Agent) tools.
 *
 * With the CABU tools enabled, ordinary data questions must still go to
 * `query-datasource`, and only an explicit request for Tableau Agent / CABU may
 * reach `cabu-start-conversation`. These assert only on which tools the model
 * picks, not on answer quality, so they use the harness primitives rather than
 * `grade()`.
 */
const agentSystemPrompt = `
  You are an assistant responsible for evaluating the results of calling various tools.
  Given the user's query, use the tools available to you to answer the question.`;

const CABU_TOOLS = ['cabu_start_conversation', 'cabu_ask'];

// Tools may be recorded with or without the `tableau_` prefix (see getAgent).
function normalizeToolName(name: string): string {
  return name.replace(/^tableau_/, '').replace(/-/g, '_');
}

async function getCalledToolNames(mcpServer: MCPServerStdio, prompt: string): Promise<string[]> {
  const agent = await getAgent({ mcpServer, model: getModel(), systemPrompt: agentSystemPrompt });

  const stream: StreamedRunResult<any, any> = await withTrace('run_cabu_eval_agent', async () => {
    const result = await run(agent, prompt, { stream: true });
    if (process.env.ENABLE_LOGGING === 'true') {
      result.toTextStream({ compatibleWithNodeStreams: true }).pipe(process.stdout);
    }

    await result.completed;
    return result;
  });

  const toolExecutions = await getToolExecutions(stream);
  return toolExecutions.map((toolExecution) => normalizeToolName(toolExecution.name));
}

const ORDINARY_DATA_PROMPTS = [
  'Using the Superstore data source, what are the total sales by region?',
  'In the Superstore data source, which 5 products had the highest profit?',
  'How has monthly sales in the Superstore data source trended over the last year?',
];

const EXPLICIT_CABU_PROMPTS = [
  'Ask Tableau Agent: what are the total sales by region in the Superstore data source?',
  'Use CABU to start a conversation about the Superstore data source and ask it which category is most profitable.',
];

describe('cabu tool selection (eval)', () => {
  let mcpServer: MCPServerStdio;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeEach(async () => {
    mcpServer = await getMcpServer({ ...getDefaultEnv(), TABLEAU_AGENT_TOOLS_ENABLED: 'true' });
  });

  afterEach(async () => {
    await mcpServer?.close();
  });

  it.each(ORDINARY_DATA_PROMPTS)(
    'routes an ordinary data question to query-datasource, not CABU: %s',
    async (prompt) => {
      const calledTools = await getCalledToolNames(mcpServer, prompt);

      expect(calledTools).toContain('query_datasource');
      expect(calledTools.filter((name) => CABU_TOOLS.includes(name))).toEqual([]);
    },
  );

  it.each(EXPLICIT_CABU_PROMPTS)(
    'routes an explicit Tableau Agent / CABU request to cabu-start-conversation: %s',
    async (prompt) => {
      const calledTools = await getCalledToolNames(mcpServer, prompt);

      expect(calledTools).toContain('cabu_start_conversation');
    },
  );
});
