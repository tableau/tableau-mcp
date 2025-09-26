import {
  Agent,
  getAllMcpTools,
  MCPServerStdio,
  OpenAIChatCompletionsModel,
  run,
  StreamedRunResult,
  withTrace,
} from '@openai/agents';
import dotenv from 'dotenv';
import { OpenAI } from 'openai/client.js';
import z from 'zod';

import { Datasource } from '../e2e/constants.js';
import { getDefaultEnv, getSuperstoreDatasource, resetEnv, setEnv } from '../e2e/testEnv.js';
import { dataSourceSchema } from '../src/sdks/tableau/types/dataSource.js';
import { fieldsResultSchema } from '../src/tools/getDatasourceMetadata/datasourceMetadataUtils.js';
import {
  Model,
  OLLAMA_API_BASE_URL,
  OLLAMA_FAKE_API_KEY,
  pullOllamaModel,
  throwIfOllamaNotRunning,
} from './ollama.js';

type ToolExecution = {
  name: string;
  arguments: Record<string, unknown>;
  output: string;
};

const MODEL_TO_USE: Model = 'qwen3:4b';
const TEN_MINUTES = 10 * 60 * 1000;

describe('list-datasources', () => {
  let mcpServer: MCPServerStdio;
  let superstore: Datasource;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeAll(async () => {
    dotenv.config({ path: 'eval/.env' });

    await throwIfOllamaNotRunning();
    await pullOllamaModel(MODEL_TO_USE);
  }, TEN_MINUTES);

  beforeEach(async () => {
    const env = getDefaultEnv();
    superstore = getSuperstoreDatasource(env);

    mcpServer = new MCPServerStdio({
      command: 'node',
      args: ['build/index.js'],
      env,
      cacheToolsList: true,
    });

    await mcpServer.connect();
  });

  afterEach(async () => {
    await mcpServer.close();
  });

  it('should call list_datasources tool', async () => {
    const message =
      'List the data sources that are available on my Tableau site. Do not perform any analysis on the the list of data sources, just show the list.';
    log(`Running: ${message}`);

    const agent = await getAgentWithTools(mcpServer, 'list_datasources');

    const result = await withTrace('run_agent', async () => {
      const stream = await run(agent, message, { stream: true });
      stream.toTextStream({ compatibleWithNodeStreams: true }).pipe(process.stdout);

      await stream.completed;
      return stream;
    });

    const toolExecutions = await getToolExecutions(result);

    expect(toolExecutions.length).toBe(1);
    expect(toolExecutions[0].name).toBe('list_datasources');
    expect(toolExecutions[0].arguments.filter).toBeFalsy();

    const datasources = z.array(dataSourceSchema).parse(JSON.parse(toolExecutions[0].output));
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
    log(`Running: ${message}`);

    const agent = await getAgentWithTools(mcpServer, 'get_datasource_metadata');

    const result = await withTrace('run_agent', async () => {
      const stream = await run(agent, message, { stream: true });
      stream.toTextStream({ compatibleWithNodeStreams: true }).pipe(process.stdout);

      await stream.completed;
      return stream;
    });

    const toolExecutions = await getToolExecutions(result);
    expect(toolExecutions.length).toBe(2);
    expect(toolExecutions[0].name).toBe('list_datasources');
    expect(toolExecutions[0].arguments).toEqual({});

    const datasources = z.array(dataSourceSchema).parse(JSON.parse(toolExecutions[0].output));
    expect(datasources.length).greaterThan(0);
    const datasource = datasources.find(
      (datasource) => datasource.name === 'Superstore Datasource',
    );

    expect(datasource).toMatchObject({
      id: superstore.id,
      name: 'Superstore Datasource',
    });

    expect(toolExecutions[1].name).toBe('get_datasource_metadata');
    expect(toolExecutions[0].arguments).toEqual({ datasourceLuid: superstore.id });

    const { fields } = fieldsResultSchema.parse(JSON.parse(toolExecutions[1].output));
    expect(fields.length).toBeGreaterThan(0);

    const fieldNames = fields.map((field) => field.name);
    expect(fieldNames).toContain('Postal Code');
    expect(fieldNames).toContain('Product Name');
  });
});

async function getAgentWithTools(
  mcpServer: MCPServerStdio,
  ...toolNames: Array<string>
): Promise<Agent> {
  return await withTrace('get_agent_with_tools', async () => {
    const mcpServers = [mcpServer];

    const allTools = await getAllMcpTools(mcpServers);
    const tools = allTools.filter((t) => toolNames.includes(t.name));
    if (tools.length !== toolNames.length) {
      throw new Error(
        `Not all tools from ${toolNames.join(', ')} were found in ${allTools.map((t) => t.name).join(', ')}`,
      );
    }

    log(`Creating agent with tools: ${toolNames.join(', ')}`);

    return new Agent({
      name: 'Assistant with Tableau MCP tools',
      instructions:
        'Always answer using the available tools. Never use other tools or answer with other information. Do not second guess yourself. Always use the tool that is most appropriate for the task.',
      mcpServers,
      tools,
      modelSettings: { toolChoice: 'required' },
      model: new OpenAIChatCompletionsModel(
        new OpenAI({
          baseURL: process.env.OPENAI_BASE_URL || OLLAMA_API_BASE_URL,
          apiKey: process.env.OPENAI_API_KEY || OLLAMA_FAKE_API_KEY,
        }),
        MODEL_TO_USE,
      ),
    });
  });
}

async function getToolExecutions(
  result: StreamedRunResult<undefined, any>,
): Promise<Array<ToolExecution>> {
  const toolExecutions: Map<string, ToolExecution> = new Map();

  for (const item of result.history) {
    if (item.type === 'function_call') {
      toolExecutions.set(item.callId, {
        name: item.name,
        arguments: JSON.parse(item.arguments) as Record<string, unknown>,
        output: '',
      });
    }
  }

  for (const item of result.history) {
    if (item.type === 'function_call_result') {
      const call = toolExecutions.get(item.callId);
      if (!call) {
        throw new Error(`Could not find tool execution for callId ${item.callId}`);
      }

      call.output =
        item.output.type === 'text'
          ? item.output.text
          : item.output.type === 'image'
            ? item.output.data
            : '';
    }
  }

  log('tool executions:');
  const executions = [...toolExecutions.values()];
  for (const execution of executions) {
    log(execution.name);
    log(execution.arguments);
    log(execution.output);
  }

  return executions;
}

function log(message?: any): void {
  if (process.env.ENABLE_LOGGING === 'true') {
    console.log(message);
  }
}
