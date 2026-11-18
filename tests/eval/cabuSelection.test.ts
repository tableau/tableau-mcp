import { MCPServerStdio } from '@openai/agents';
import dotenv from 'dotenv';
import z from 'zod';

import invariant from '../../src/utils/invariant.js';
import { getDefaultEnv, resetEnv, setEnv } from '../testEnv.js';
import { getAgent, getMcpServer, getModel, getToolExecutions } from './base.js';
import {
  CABU_TOOLS,
  findCalls,
  normalizeToolName,
  parseToolResult,
  runTurn,
} from './cabuHelpers.js';

dotenv.config({ path: 'tests/eval/.env' });

/**
 * Tool-selection evals for the Tableau Agent tools.
 *
 * With the Tableau Agent tools enabled, ordinary data questions must still go to
 * `query-datasource`, and only asking for Tableau Agent by name ("Ask Tableau Agent",
 * "use Tableau Agent", "use Tableau's agent") may reach `tableau-agent-start-conversation`. Near-miss wording must not. These assert only on which
 * tools the model picks, not on answer quality, so they use the harness primitives
 * rather than `grade()`.
 *
 * The multi-turn case also checks that a follow-up question stays in the same
 * CABU conversation. It needs CABU to actually answer on the eval site, since
 * `nextParentLuid` only comes back from a real CABU response.
 */
const agentSystemPrompt = `
  You are an assistant responsible for evaluating the results of calling various tools.
  Given the user's query, use the tools available to you to answer the question.`;

async function getCalledToolNames(mcpServer: MCPServerStdio, prompt: string): Promise<string[]> {
  const agent = await getAgent({ mcpServer, model: getModel(), systemPrompt: agentSystemPrompt });
  const toolExecutions = await getToolExecutions(await runTurn(agent, prompt));
  return toolExecutions.map((toolExecution) => normalizeToolName(toolExecution.name));
}

// The site has several data sources named "Sample - Superstore", so name the project too.
const SUPERSTORE = 'the "Sample - Superstore" data source in the "ACE AI Applications" project';

// A turn that reaches Tableau Agent can take a minute or more.
const SELECTION_TIMEOUT_MS = 3 * 60 * 1000;

const ORDINARY_DATA_PROMPTS = [
  `Using ${SUPERSTORE}, what are the total sales by region?`,
  `In ${SUPERSTORE}, which 5 products had the highest profit?`,
  `How has monthly sales in ${SUPERSTORE} trended over the last year?`,
];

// Close to the activation phrase, but not it. Existing Q&A traffic must not reach Tableau Agent.
const NEAR_MISS_PROMPTS = [
  `Use CABU to find which category is most profitable in ${SUPERSTORE}.`,
  `Ask an agent to find the total sales by region in ${SUPERSTORE}.`,
  `Hand this off to an agent: which region had the highest profit in ${SUPERSTORE}?`,
];

const ASK_TABLEAU_AGENT_PROMPTS = [
  `Ask Tableau Agent: what are the total sales by region in ${SUPERSTORE}?`,
  `For ${SUPERSTORE}, ask tableau agent which category is most profitable.`,
  `Use Tableau's agent to find the total sales by region in ${SUPERSTORE}.`,
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
    SELECTION_TIMEOUT_MS,
  );

  it.each(NEAR_MISS_PROMPTS)(
    'does not treat near-miss wording as asking for Tableau Agent: %s',
    async (prompt) => {
      const calledTools = await getCalledToolNames(mcpServer, prompt);

      expect(calledTools.filter((name) => CABU_TOOLS.includes(name))).toEqual([]);
    },
    SELECTION_TIMEOUT_MS,
  );

  it.each(ASK_TABLEAU_AGENT_PROMPTS)(
    'routes a request for Tableau Agent by name to tableau-agent-start-conversation: %s',
    async (prompt) => {
      const calledTools = await getCalledToolNames(mcpServer, prompt);

      expect(calledTools).toContain('tableau_agent_start_conversation');
    },
    SELECTION_TIMEOUT_MS,
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
        `Ask Tableau Agent: what are the total sales by region in ${SUPERSTORE}?`,
      );
      const turn1Executions = await getToolExecutions(turn1);

      const startCalls = findCalls(turn1Executions, 'tableau_agent_start_conversation');
      expect(startCalls).toHaveLength(1);
      const started = parseToolResult(startCalls[0], z.object({ conversationToken: z.string() }));
      invariant(
        started,
        `tableau-agent-start-conversation failed, so the follow-up can't be checked. Is Tableau Agent enabled on the eval site? Output: ${startCalls[0].output}`,
      );

      const turn1Asks = findCalls(turn1Executions, 'tableau_agent_ask');
      invariant(
        turn1Asks.length > 0,
        'turn 1 started a conversation but never called tableau-agent-ask',
      );
      const lastTurn1Ask = turn1Asks[turn1Asks.length - 1];
      expect(lastTurn1Ask.arguments.conversationToken).toBe(started.conversationToken);

      const turn1Answer = parseToolResult(
        lastTurn1Ask,
        z.object({ nextParentLuid: z.string() }).passthrough(),
      );
      invariant(
        turn1Answer,
        `turn 1 tableau-agent-ask returned no nextParentLuid. Output: ${lastTurn1Ask.output}`,
      );

      // Turn 2: a follow-up that only makes sense with turn 1's context.
      const turn2 = await runTurn(agent, [
        ...turn1.history,
        { role: 'user', content: 'Now break that down by category, just for the West region.' },
      ]);
      // turn2.history repeats turn 1's items first, so keep only the new calls.
      const turn2Executions = (await getToolExecutions(turn2)).slice(turn1Executions.length);

      // The follow-up must continue the conversation, not start a new one.
      expect(findCalls(turn2Executions, 'tableau_agent_start_conversation')).toEqual([]);
      expect(findCalls(turn2Executions, 'query_datasource')).toEqual([]);

      const turn2Asks = findCalls(turn2Executions, 'tableau_agent_ask');
      invariant(turn2Asks.length > 0, 'turn 2 did not call tableau-agent-ask');
      const firstTurn2Ask = turn2Asks[0];

      expect(firstTurn2Ask.arguments).toMatchObject({
        conversationToken: started.conversationToken,
        parentLuid: turn1Answer.nextParentLuid,
      });
    },
    // Two turns, each of which can wait minutes on Tableau Agent.
    2 * SELECTION_TIMEOUT_MS,
  );
});
