import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  Agent,
  getAllMcpTools,
  MCPServerStdio,
  OpenAIChatCompletionsModel,
  StreamedRunResult,
  withTrace,
} from '@openai/agents';
import { OpenAI } from 'openai/client.js';
import { Err, Ok, Result } from 'ts-results-es';
import z from 'zod';

import invariant from '../../src/utils/invariant.js';
import { getSupportedModels } from './llmGatewayExpressApi.js';

type ToolExecution = {
  name: string;
  arguments: Record<string, unknown>;
  output: string;
};

const LLM_GATEWAY_EXPRESS_URL =
  'https://eng-ai-model-gateway.sfproxy.devx.aws-dev2-uswest2.aws.sfdc.cl';

export async function getApiKey(): Promise<string> {
  const { OPENAI_API_KEY } = process.env;

  if (!OPENAI_API_KEY) {
    throw new Error(
      [
        'OPENAI_API_KEY is not set.',
        '1. Go to https://eng-ai-model-gateway.sfproxy.devx.aws-dev2-uswest2.aws.sfdc.cl/',
        '2. Log in using SSO and click "Generate Key"',
        '3. Copy the key and add it to the tests/eval/.env file i.e. OPENAI_API_KEY=your-api-key',
        'For more info, see https://git.soma.salesforce.com/pages/codeai/eng-ai-model-gateway/#/',
      ].join('\n'),
    );
  }

  return OPENAI_API_KEY;
}

export async function validateCertChain(): Promise<void> {
  const { OPENAI_BASE_URL, NODE_EXTRA_CA_CERTS } = process.env;

  if ((!OPENAI_BASE_URL || OPENAI_BASE_URL === LLM_GATEWAY_EXPRESS_URL) && !NODE_EXTRA_CA_CERTS) {
    throw new Error(
      [
        'NODE_EXTRA_CA_CERTS is not set. This is required when using the LLM Gateway Express.',
        '1. Go to https://git.soma.salesforce.com/pages/codeai/eng-ai-model-gateway/#/',
        '2. Click the SSL lock icon > Connection is secure > Show certificate button > Details tab',
        '3. Click Export and choose the Base64-encoded ASCII **certificate chain** option. This is not necessarily the default selected option in the Save dialog. Make sure you explicitly choose the **chain**.',
        '4. Name the file something like ingressgateway.pem, put it somewhere "permanent" like in your home directory',
        '5. Open the file in a text editor and verify you see all certs in the chain, not just a single cert.',
        '6. Set the NODE_EXTRA_CA_CERTS environment variable to the path of the file i.e. NODE_EXTRA_CA_CERTS=path/to/ingressgateway.pem',
        '7. Note that this cannot be done with the .env file. See https://nodejs.org/docs/latest/api/cli.html#node_extra_ca_certsfile',
      ].join('\n'),
    );
  }
}

export async function getModel(apiKey: string): Promise<string> {
  const { EVAL_TEST_MODEL } = process.env;

  const model = EVAL_TEST_MODEL || 'claude-sonnet-4-5-20250929';
  const supportedModels = await getSupportedModels(apiKey);

  if (!supportedModels.includes(model)) {
    throw new Error(
      `Model ${model} is not supported by the LLM Gateway Express. Supported models: \n${supportedModels.join('\n')}`,
    );
  }

  return model;
}

export async function getMcpServer(env?: Record<string, string>): Promise<MCPServerStdio> {
  const mcpServer = new MCPServerStdio({
    command: 'node',
    args: ['build/index.js'],
    env,
    cacheToolsList: true,
  });

  await mcpServer.connect();
  return mcpServer;
}

export async function getAgentWithTools(mcpServer: MCPServerStdio, model: string): Promise<Agent> {
  return await withTrace('get_agent_with_tools', async () => {
    const mcpServers = [mcpServer];

    const tools = await getAllMcpTools(mcpServers);
    tools.forEach((tool) => {
      tool.name = `tableau_${tool.name}`;
    });

    return new Agent({
      name: 'Assistant with Tableau MCP tools',
      instructions:
        'Always answer using the available tools. Never use other tools or answer with other information. Do not second guess yourself. Always use the tool that is most appropriate for the task.',
      mcpServers,
      tools,
      modelSettings: { toolChoice: 'required' },
      model: new OpenAIChatCompletionsModel(
        new OpenAI({
          baseURL: process.env.OPENAI_BASE_URL || LLM_GATEWAY_EXPRESS_URL,
          apiKey: process.env.OPENAI_API_KEY,
        }),
        model,
      ),
    });
  });
}

export async function getToolExecutions(
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
    log(`  arguments: ${JSON.stringify(execution.arguments)}`);
    log(`  output: ${execution.output}`);
    log('\n');
  }

  return executions;
}

export function getCallToolResult<Z extends z.ZodTypeAny = z.ZodNever>(
  toolExecution: ToolExecution,
  schema: Z,
): z.infer<Z> {
  const callToolResult = CallToolResultSchema.parse(JSON.parse(toolExecution.output));
  invariant(callToolResult.type === 'text');
  invariant(typeof callToolResult.text === 'string');
  const result = schema.parse(JSON.parse(callToolResult.text));
  return result;
}

export function getCallToolResultSafe<Z extends z.ZodTypeAny = z.ZodNever>(
  toolExecution: ToolExecution,
  schema: Z,
): Result<z.infer<Z>, z.ZodError> {
  const callToolResult = CallToolResultSchema.safeParse(JSON.parse(toolExecution.output));
  if (!callToolResult.success) {
    return Err(callToolResult.error);
  }

  invariant(callToolResult.data.type === 'text');
  invariant(typeof callToolResult.data.text === 'string');
  const result = schema.parse(JSON.parse(callToolResult.data.text));
  return Ok(result);
}

export function log(message?: any, force?: boolean): void {
  if (process.env.ENABLE_LOGGING === 'true' || force) {
    console.log(message);
  }
}
