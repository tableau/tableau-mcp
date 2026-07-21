import { MCPServerStdio, run, StreamedRunResult, withTrace } from '@openai/agents';
import dotenv from 'dotenv';

import invariant from '../../src/utils/invariant.js';
import { getDefaultEnv, resetEnv, setEnv } from '../testEnv.js';
import { getAgent, getMcpServer, getModel, getToolExecutions } from './base.js';

/**
 * Description-quality evals for the flows tools.
 *
 * Unlike the datasource evals, these assert ONLY on tool selection and the
 * arguments the model generates — not on returned data. That keeps them robust
 * on any configured site, including ones with no Prep flows (the shared eval
 * sites in `tests/constants.ts` carry no flow fixtures). Their job is to confirm
 * the (trimmed) `list-flows` / `get-flow` descriptions still steer the model to
 * the right tool with the right arguments.
 *
 * They therefore use the harness primitives directly rather than `grade()`,
 * which scores end-to-end answer quality and so depends on real flow data.
 *
 * Like every eval here, they are local-only and require `OPENAI_API_KEY` plus a
 * site configured in `tests/.env` (see docs/docs/developers/eval-tests.md).
 */
const agentSystemPrompt = `
  You are an assistant responsible for evaluating the results of calling various tools.
  Given the user's query, use the tools available to you to answer the question.`;

async function runAgentWithTools(
  mcpServer: MCPServerStdio,
  model: string,
  prompt: string,
): Promise<StreamedRunResult<any, any>> {
  const agent = await getAgent({ mcpServer, model, systemPrompt: agentSystemPrompt });

  return await withTrace('run_flows_eval_agent', async () => {
    const stream = await run(agent, prompt, { stream: true });
    if (process.env.ENABLE_LOGGING === 'true') {
      stream.toTextStream({ compatibleWithNodeStreams: true }).pipe(process.stdout);
    }

    await stream.completed;
    return stream;
  });
}

describe('flows tool descriptions (eval)', () => {
  let mcpServer: MCPServerStdio;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeAll(async () => {
    dotenv.config({ path: 'tests/eval/.env' });
  });

  beforeEach(async () => {
    // Flow tools are gated off by default (FLOW_TOOLS_ENABLED); opt in for this eval.
    mcpServer = await getMcpServer({ ...getDefaultEnv(), FLOW_TOOLS_ENABLED: 'true' });
  });

  afterEach(async () => {
    await mcpServer?.close();
  });

  it('list-flows: derives an ownerName=<display name> filter from a display-name prompt', async () => {
    const prompt =
      'List the Tableau Prep flows owned by the user whose display name is "Jane Doe". Just list them; no analysis.';

    const stream = await runAgentWithTools(mcpServer, getModel(), prompt);
    const toolExecutions = await getToolExecutions(stream);

    const listFlows = toolExecutions.find((toolExecution) => toolExecution.name === 'list_flows');
    invariant(listFlows, 'list_flows tool execution not found');

    // The description states `ownerName` matches the owner's `fullName` (display
    // name) ONLY, so the model should pass the display name verbatim rather than
    // inventing an email/login or reaching for a different (unsupported) field.
    expect(String(listFlows.arguments.filter ?? '')).toContain('ownerName:eq:Jane Doe');
  });

  it('get-flow: requests only the runs sidecar with a small limit for a status check', async () => {
    const flowId = 'd00700fe-28a0-4ece-a7af-5543ddf38a82';
    const prompt =
      `For the Tableau Prep flow with id ${flowId}, I only need to know whether its most ` +
      'recent run succeeded. I do not need its input data connections.';

    const stream = await runAgentWithTools(mcpServer, getModel(), prompt);
    const toolExecutions = await getToolExecutions(stream);

    const getFlow = toolExecutions.find(
      (toolExecution) =>
        toolExecution.name === 'get_flow' && toolExecution.arguments.flowId === flowId,
    );
    invariant(getFlow, 'get_flow tool execution not found');

    // The description steers a status check toward: connections off, runs on, and
    // a small `flowRunLimit` ("Did the latest run succeed?" → flowRunLimit: 1).
    expect(getFlow.arguments.includeConnections).toBe(false);
    expect(getFlow.arguments.includeFlowRuns).not.toBe(false);
    expect(Number(getFlow.arguments.flowRunLimit ?? 10)).toBeLessThanOrEqual(3);
  });
});
