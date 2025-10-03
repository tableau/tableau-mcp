import { MCPServerStdio } from '@openai/agents';
import dotenv from 'dotenv';
import z from 'zod';

import { dataSourceSchema } from '../../src/sdks/tableau/types/dataSource.js';
import { Datasource } from '../constants.js';
import { getDefaultEnv, getSuperstoreDatasource, resetEnv, setEnv } from '../testEnv.js';
import {
  getApiKey,
  getCallToolResult,
  getMcpServer,
  getModel,
  getToolExecutions,
  validateCertChain,
} from './base.js';
import { grade } from './grade.js';

describe('list-datasources', () => {
  let model: string;
  let mcpServer: MCPServerStdio;
  let superstore: Datasource;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeAll(async () => {
    dotenv.config({ path: 'tests/eval/.env' });
    const apiKey = await getApiKey();
    await validateCertChain();
    model = await getModel(apiKey);
  });

  beforeEach(async () => {
    const env = getDefaultEnv();
    superstore = getSuperstoreDatasource(env);
    mcpServer = await getMcpServer(env);
  });

  afterEach(async () => {
    await mcpServer?.close();
  });

  it('should call list_datasources tool', async () => {
    const prompt =
      'List the data sources that are available on my Tableau site. Do not perform any analysis on the the list of data sources, just show the list.';

    const { agentResult } = await grade({
      mcpServer,
      model,
      prompt,
    });

    const toolExecutions = await getToolExecutions(agentResult);

    expect(toolExecutions.length).toBe(1);
    expect(toolExecutions[0].name).toBe('list_datasources');
    expect(toolExecutions[0].arguments.filter).toBeFalsy();

    const datasources = getCallToolResult(toolExecutions[0], z.array(dataSourceSchema));
    expect(datasources.length).greaterThan(0);
    const datasource = datasources.find(
      (datasource) => datasource.name === 'Superstore Datasource',
    );

    expect(datasource).toMatchObject({
      id: superstore.id,
      name: 'Superstore Datasource',
    });
  });
});
