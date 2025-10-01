import { MCPServerStdio, run, withTrace } from '@openai/agents';
import dotenv from 'dotenv';
import z from 'zod';

import { dataSourceSchema } from '../../src/sdks/tableau/types/dataSource.js';
import { fieldsResultSchema } from '../../src/tools/getDatasourceMetadata/datasourceMetadataUtils.js';
import invariant from '../../src/utils/invariant.js';
import { Datasource } from '../constants.js';
import { getDefaultEnv, getSuperstoreDatasource, resetEnv, setEnv } from '../e2e/testEnv.js';
import {
  getAgentWithTools,
  getApiKey,
  getCallToolResult,
  getCallToolResultSafe,
  getMcpServer,
  getModel,
  getToolExecutions,
  log,
  validateCertChain,
} from './base.js';

describe('get-datasource-metadata', () => {
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
    await mcpServer.close();
  });

  it('should call get_datasource_metadata tool', async () => {
    const message = `For the Superstore data source, get its metadata. Do not perform any analysis on the metadata, just show it.`;
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
    expect(toolExecutions.length).toBeGreaterThanOrEqual(2);

    const listDatasourcesToolExecution = toolExecutions.find((toolExecution) => {
      if (toolExecution.name !== 'list_datasources') {
        return false;
      }

      const result = getCallToolResultSafe(toolExecution, z.array(dataSourceSchema));
      if (result.isErr()) {
        return false;
      }

      if (result.value.length === 0) {
        return false;
      }

      return true;
    });

    invariant(listDatasourcesToolExecution, 'list_datasources tool execution not found');

    const datasources = getCallToolResult(listDatasourcesToolExecution, z.array(dataSourceSchema));
    expect(datasources.length).greaterThan(0);
    const datasource = datasources.find(
      (datasource) => datasource.name === 'Superstore Datasource',
    );

    expect(datasource).toMatchObject({
      id: superstore.id,
      name: 'Superstore Datasource',
    });

    const getDatasourceMetadataToolExecution = toolExecutions.find((toolExecution) => {
      return (
        toolExecution.name === 'get_datasource_metadata' &&
        toolExecution.arguments.datasourceLuid === superstore.id
      );
    });

    invariant(
      getDatasourceMetadataToolExecution,
      'get_datasource_metadata tool execution not found',
    );

    const { fields } = getCallToolResult(getDatasourceMetadataToolExecution, fieldsResultSchema);
    expect(fields.length).toBeGreaterThan(0);

    const fieldNames = fields.map((field) => field.name);
    expect(fieldNames).toContain('Postal Code');
    expect(fieldNames).toContain('Product Name');
  });
});
