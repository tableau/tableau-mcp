import { MCPServerStdio, run, StreamedRunResult, withTrace } from '@openai/agents';
import dotenv from 'dotenv';

import invariant from '../../src/utils/invariant.js';
import { getDefaultEnv, resetEnv, setEnv } from '../testEnv.js';
import { getAgent, getMcpServer, getModel, getToolExecutions } from './base.js';

const defaultGraphId = '16ca1f04951844e2aeb26ca744d41e85';
const agentSystemPrompt = `
  You answer business-definition questions only from evidence returned by the available tools.
  Prefer Tableau Knowledge for governed terms, definitions, formulas, and graph scope. Never invent a
  graph ID or substitute a plausible proxy metric. Do not call write tools.`;

async function runAgent(
  mcpServer: MCPServerStdio,
  prompt: string,
): Promise<StreamedRunResult<any, any>> {
  const agent = await getAgent({ mcpServer, model: getModel(), systemPrompt: agentSystemPrompt });

  return await withTrace('run_knowledge_acv_eval_agent', async () => {
    const stream = await run(agent, prompt, { stream: true });
    if (process.env.ENABLE_LOGGING === 'true') {
      stream.toTextStream({ compatibleWithNodeStreams: true }).pipe(process.stdout);
    }
    await stream.completed;
    return stream;
  });
}

describe('Tableau Knowledge ACV demo (eval)', () => {
  let mcpServer: MCPServerStdio;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeAll(() => {
    dotenv.config({ path: 'tests/eval/.env' });
  });

  beforeEach(async () => {
    mcpServer = await getMcpServer({
      ...getDefaultEnv(),
      INCLUDE_TOOLS:
        'search-knowledge-nodes,get-knowledge-node,get-knowledge-node-relationships,list-knowledge-semantic-statements',
    });
  });

  afterEach(async () => {
    await mcpServer?.close();
  });

  it('grounds the Sales Cloud definition and formula in Knowledge graph evidence', async () => {
    const graphId = process.env.KNOWLEDGE_ACV_GRAPH_ID || defaultGraphId;
    const prompt =
      `Using Tableau Knowledge graph ${graphId}, tell me what ACV means for Sales Cloud and how it ` +
      'is calculated. Use the available Tableau tools to ground your answer. Do not modify anything. ' +
      'If the graph does not establish the answer, say so rather than inventing a proxy.';

    const result = await runAgent(mcpServer, prompt);
    const toolExecutions = await getToolExecutions(result);
    expect(toolExecutions).toHaveLength(2);
    expect(toolExecutions[0]?.name).toBe('search_knowledge_nodes');
    expect(toolExecutions[1]?.name).toBe('get_knowledge_node_relationships');
    const search = toolExecutions.find((execution) => execution.name === 'search_knowledge_nodes');
    invariant(search, 'search_knowledge_nodes tool execution not found');
    expect(search.arguments.graphId).toBe(graphId);
    expect(String(search.arguments.query).toLowerCase()).toContain('acv');
    expect(search.arguments.limit).toBeLessThanOrEqual(10);
    expect(search.output).toContain('ACV (or Annual Contract Value)');
    expect(search.output).toContain('[Current Year Contract Value]');
    expect(search.output).toContain('[Prior Year Contract Value]');
    const acvNodeId = search.output.match(/"id":"([^"]+)"[^}]*"name":"ACV"/)?.[1];
    invariant(acvNodeId, 'ACV node ID not found in search output');

    const relationships = toolExecutions.find(
      (execution) => execution.name === 'get_knowledge_node_relationships',
    );
    invariant(relationships, 'get_knowledge_node_relationships tool execution not found');
    expect(relationships.arguments.graphId).toBe(graphId);
    expect(relationships.arguments.nodeId).toBe(acvNodeId);
    expect(relationships.arguments.query).toBeUndefined();
    expect(relationships.output).toContain('DESCRIBES');
    expect(relationships.output).toContain('Sales Cloud');

    expect(
      toolExecutions.every(
        (execution) =>
          execution.name !== 'get_knowledge_node' &&
          execution.name !== 'list_knowledge_semantic_statements' &&
          execution.name !== 'create_knowledge_semantic_statements' &&
          execution.name !== 'update_knowledge_semantic_statements',
      ),
    ).toBe(true);

    const answer = result.finalOutput ?? '';
    expect(answer).toMatch(
      /\[?Current Year Contract Value\]?\s*(?:-|−|minus)\s*\[?Prior Year Contract Value\]?(?!\s*(?:\+|-|−|minus)\s*\[?\w)/i,
    );
    expect(answer).toMatch(/Sales Cloud/i);
    expect(answer).toMatch(/DESCRIBES|linked|relationship/i);
  });
});
