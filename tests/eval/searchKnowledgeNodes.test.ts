import { MCPServerStdio } from '@openai/agents';
import dotenv from 'dotenv';

import { knowledgeNodeSearchResponseSchema } from '../../src/sdks/tableau/apis/knowledgeApi.js';
import { getDefaultEnv, resetEnv, setEnv } from '../testEnv.js';
import { getCallToolResult, getMcpServer, getModel, getToolExecutions } from './base.js';
import { grade } from './grade.js';

describe('search-knowledge-nodes', () => {
  let mcpServer: MCPServerStdio;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeAll(async () => {
    dotenv.config({ path: 'tests/eval/.env' });
  });

  beforeEach(async () => {
    mcpServer = await getMcpServer(getDefaultEnv());
  });

  afterEach(async () => {
    await mcpServer?.close();
  });

  // The prompt names no graph. Under the graph_id-optional contract the agent
  // calls the tool with only `query`; omitting graphId targets the site's active
  // graph. If graphId were still required (or the tool told the model to supply
  // one), the model would either refuse or invent an id — the graphId assertion
  // below is what catches that regression.
  it('searches the default graph without inventing a graphId', async () => {
    const prompt =
      'Search my Tableau Knowledge graph for revenue-related nodes and give me the top matches, with a one-sentence summary of what you found.';

    const { agentResult } = await grade({
      mcpServer,
      model: getModel(),
      prompt,
    });

    const toolExecutions = await getToolExecutions(agentResult);
    const search = toolExecutions.find((e) => e.name === 'search_knowledge_nodes');

    expect(search).toBeDefined();
    expect(search!.arguments.graphId).toBeUndefined();
    expect(search!.arguments.query).toEqual(expect.any(String));

    const { matches } = getCallToolResult(search!, knowledgeNodeSearchResponseSchema);
    expect(Array.isArray(matches)).toBe(true);
  });
});
