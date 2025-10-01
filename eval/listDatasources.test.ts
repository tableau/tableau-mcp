import { MCPServerStdio, run, withTrace } from '@openai/agents';
import dotenv from 'dotenv';
import z from 'zod';

import { Datasource } from '../e2e/constants.js';
import { getDefaultEnv, getSuperstoreDatasource, resetEnv, setEnv } from '../e2e/testEnv.js';
import { dataSourceSchema } from '../src/sdks/tableau/types/dataSource.js';
import { fieldsResultSchema } from '../src/tools/getDatasourceMetadata/datasourceMetadataUtils.js';
import {
  getAgentWithTools,
  getApiKey,
  getCallToolResult,
  getMcpServer,
  getModel,
  getToolExecutions,
  log,
  validateCertChain,
} from './base.js';

describe('list-datasources', () => {
  let model: string;
  let mcpServer: MCPServerStdio;
  let superstore: Datasource;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeAll(async () => {
    dotenv.config({ path: 'eval/.env' });
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
    await mcpServer.close();
  });

  it('should call list_datasources tool', async () => {
    const message =
      'List the data sources that are available on my Tableau site. Do not perform any analysis on the the list of data sources, just show the list.';
    log(`Running: ${message}`, true);

    const agent = await getAgentWithTools(mcpServer, model);

    const result = await withTrace('run_agent', async () => {
      const stream = await run(agent, message, { stream: true });
      if (process.env.ENABLE_LOGGING === 'true') {
        stream.toTextStream({ compatibleWithNodeStreams: true }).pipe(process.stdout);
      }

      await stream.completed;
      return stream;
    });

    const toolExecutions = await getToolExecutions(result);

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

  it('should call get_datasource_metadata tool', async () => {
    const message = `For the Superstore data source, get its metadata. The data source luid for the Superstore data source is ${superstore.id}. Do not perform any analysis on the metadata, just show it.`;
    log(`Running: ${message}`, true);

    const agent = await getAgentWithTools(mcpServer, model);

    const result = await withTrace('run_agent', async () => {
      const stream = await run(agent, message, { stream: true });
      if (process.env.ENABLE_LOGGING === 'true') {
        stream.toTextStream({ compatibleWithNodeStreams: true }).pipe(process.stdout);
      }

      await stream.completed;
      return stream;
    });

    const toolExecutions = await getToolExecutions(result);
    expect(toolExecutions.length).toBe(1);

    expect(toolExecutions[0].name).toBe('get_datasource_metadata');
    expect(toolExecutions[0].arguments).toEqual({ datasourceLuid: superstore.id });

    const { fields } = getCallToolResult(toolExecutions[0], fieldsResultSchema);
    expect(fields.length).toBeGreaterThan(0);

    const fieldNames = fields.map((field) => field.name);
    expect(fieldNames).toContain('Postal Code');
    expect(fieldNames).toContain('Product Name');
  });
});
