import {
  Agent,
  AgentInputItem,
  MCPServerStdio,
  run,
  StreamedRunResult,
  withTrace,
} from '@openai/agents';
import dotenv from 'dotenv';
import z from 'zod';

import invariant from '../../src/utils/invariant.js';
import { getDefaultEnv, resetEnv, setEnv } from '../testEnv.js';
import { getAgent, getCallToolResult, getMcpServer, getModel, getToolExecutions } from './base.js';

dotenv.config({ path: 'tests/eval/.env' });

/**
 * Tool-selection evals for the CABU (Tableau Agent) tools.
 *
 * With the CABU tools enabled, ordinary data questions must still go to
 * `query-datasource`, and only an explicit request for Tableau Agent / CABU may
 * reach `cabu-start-conversation`. These assert only on which tools the model
 * picks, not on answer quality, so they use the harness primitives rather than
 * `grade()`.
 *
 * The multi-turn case also checks that a follow-up question stays in the same
 * CABU conversation. It needs CABU to actually answer on the eval site, since
 * `nextParentLuid` only comes back from a real CABU response.
 */
const agentSystemPrompt = `
  You are an assistant responsible for evaluating the results of calling various tools.
  Given the user's query, use the tools available to you to answer the question.`;

const CABU_TOOLS = ['cabu_start_conversation', 'cabu_ask'];

type ToolExecution = Awaited<ReturnType<typeof getToolExecutions>>[number];

// Tools may be recorded with or without the `tableau_` prefix (see getAgent).
function normalizeToolName(name: string): string {
  return name.replace(/^tableau_/, '').replace(/-/g, '_');
}

async function runTurn(
  agent: Agent,
  input: string | Array<AgentInputItem>,
): Promise<StreamedRunResult<any, any>> {
  return await withTrace('run_cabu_eval_agent', async () => {
    const result = await run(agent, input, { stream: true });
    if (process.env.ENABLE_LOGGING === 'true') {
      result.toTextStream({ compatibleWithNodeStreams: true }).pipe(process.stdout);
    }

    await result.completed;
    return result;
  });
}

async function getCalledToolNames(mcpServer: MCPServerStdio, prompt: string): Promise<string[]> {
  const agent = await getAgent({ mcpServer, model: getModel(), systemPrompt: agentSystemPrompt });
  const toolExecutions = await getToolExecutions(await runTurn(agent, prompt));
  return toolExecutions.map((toolExecution) => normalizeToolName(toolExecution.name));
}

// Returns undefined (instead of throwing) when the tool errored or returned another shape, so the
// test can fail with a message that says which step broke.
function parseToolResult<Z extends z.ZodTypeAny>(
  execution: ToolExecution,
  schema: Z,
): z.infer<Z> | undefined {
  try {
    return getCallToolResult(execution, schema);
  } catch {
    return undefined;
  }
}

function findCalls(executions: Array<ToolExecution>, toolName: string): Array<ToolExecution> {
  return executions.filter((execution) => normalizeToolName(execution.name) === toolName);
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

  it(
    'threads a follow-up question through the same CABU conversation',
    async () => {
      const agent = await getAgent({
        mcpServer,
        model: getModel(),
        systemPrompt: agentSystemPrompt,
      });

      // Turn 1: start a CABU conversation and ask the first question.
      const turn1 = await runTurn(
        agent,
        'Ask Tableau Agent: what are the total sales by region in the Superstore data source?',
      );
      const turn1Executions = await getToolExecutions(turn1);

      const startCalls = findCalls(turn1Executions, 'cabu_start_conversation');
      expect(startCalls).toHaveLength(1);
      const started = parseToolResult(
        startCalls[0],
        z.object({ conversationId: z.string(), utteranceArgs: z.string() }),
      );
      invariant(
        started,
        `cabu-start-conversation failed, so the follow-up can't be checked. Is CABU enabled on the eval site? Output: ${startCalls[0].output}`,
      );

      const turn1Asks = findCalls(turn1Executions, 'cabu_ask');
      invariant(turn1Asks.length > 0, 'turn 1 started a conversation but never called cabu-ask');
      const lastTurn1Ask = turn1Asks[turn1Asks.length - 1];
      expect(lastTurn1Ask.arguments.conversationId).toBe(started.conversationId);

      const turn1Answer = parseToolResult(
        lastTurn1Ask,
        z.object({ nextParentLuid: z.string() }).passthrough(),
      );
      invariant(
        turn1Answer,
        `turn 1 cabu-ask returned no nextParentLuid. Output: ${lastTurn1Ask.output}`,
      );

      // Turn 2: a follow-up that only makes sense with turn 1's context.
      const turn2 = await runTurn(agent, [
        ...turn1.history,
        { role: 'user', content: 'Now break that down by category, just for the West region.' },
      ]);
      // turn2.history repeats turn 1's items first, so keep only the new calls.
      const turn2Executions = (await getToolExecutions(turn2)).slice(turn1Executions.length);

      // The follow-up must continue the conversation, not start a new one.
      expect(findCalls(turn2Executions, 'cabu_start_conversation')).toEqual([]);
      expect(findCalls(turn2Executions, 'query_datasource')).toEqual([]);

      const turn2Asks = findCalls(turn2Executions, 'cabu_ask');
      invariant(turn2Asks.length > 0, 'turn 2 did not call cabu-ask');
      const firstTurn2Ask = turn2Asks[0];

      expect(firstTurn2Ask.arguments).toMatchObject({
        conversationId: started.conversationId,
        utteranceArgs: started.utteranceArgs,
        parentLuid: turn1Answer.nextParentLuid,
      });
    },
    3 * 60 * 1000,
  );
});
