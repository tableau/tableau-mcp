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

type ToolExecution = {
  name: string;
  arguments: Record<string, unknown>;
  output: string;
};

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

function getApiKey(): string {
  const { OPENAI_API_KEY } = process.env;

  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set.');
  }

  return OPENAI_API_KEY;
}

export function getModel(): string {
  return process.env.EVAL_TEST_MODEL || DEFAULT_MODEL;
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

export async function getAgent({
  systemPrompt,
  model,
  mcpServer,
}: {
  systemPrompt: string;
  model: string;
  mcpServer?: MCPServerStdio;
}): Promise<Agent> {
  return await withTrace('get_agent', async () => {
    const agentOptions = {
      name: 'Assistant with Tableau MCP tools',
      instructions: systemPrompt,
      model: new OpenAIChatCompletionsModel(
        new OpenAI({
          baseURL: process.env.OPENAI_BASE_URL,
          apiKey: getApiKey(),
        }),
        model,
      ),
    };

    if (!mcpServer) {
      return new Agent(agentOptions);
    }

    const tools = await getAllMcpTools([mcpServer]);
    tools.forEach((tool) => {
      tool.name = `tableau_${tool.name}`;
    });

    return new Agent({
      ...agentOptions,
      mcpServers: [mcpServer],
      tools,
      modelSettings: { toolChoice: 'required' },
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

  log('🛠️ tool executions:');
  const executions = [...toolExecutions.values()];
  for (const execution of executions) {
    log(`  🔨 ${execution.name}`);
    log(`    👉 arguments: ${JSON.stringify(execution.arguments)}`);
    log(`    👈 output: ${execution.output}`);
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
