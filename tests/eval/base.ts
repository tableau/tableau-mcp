import { MultiServerMCPClient, StdioConnection } from '@langchain/mcp-adapters';
import { ChatOpenAI } from '@langchain/openai';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { createAgent } from 'langchain';
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

export async function getMcpServer(env?: Record<string, string>): Promise<StdioConnection> {
  const mcpServer: StdioConnection = {
    command: 'node',
    args: ['build/index.js'],
    env,
  };

  return mcpServer;
}

export async function getAgent({
  systemPrompt,
  model,
  mcpServer,
}: {
  systemPrompt: string;
  model: string;
  mcpServer?: StdioConnection;
}): Promise<ReturnType<typeof createAgent>> {
  const agentOptions = {
    systemPrompt,
    name: 'Assistant with Tableau MCP tools',
    model: new ChatOpenAI({
      apiKey: getApiKey(),
      model,
      verbosity: 'high',
      configuration: {
        apiKey: getApiKey(),
        baseURL: process.env.OPENAI_BASE_URL,
        logLevel: 'debug',
      },
    }),
  };

  if (!mcpServer) {
    return createAgent({
      ...agentOptions,
    });
  }

  const client = new MultiServerMCPClient({
    tableau: mcpServer,
  });

  const tools = await client.getTools();
  return createAgent({
    ...agentOptions,
    tools,
  });
}

// export async function getToolExecutions(
//   result: StreamedRunResult<undefined, any>,
// ): Promise<Array<ToolExecution>> {
//   const toolExecutions: Map<string, ToolExecution> = new Map();

//   for (const item of result.history) {
//     if (item.type === 'function_call') {
//       toolExecutions.set(item.callId, {
//         name: item.name,
//         arguments: JSON.parse(item.arguments) as Record<string, unknown>,
//         output: '',
//       });
//     }
//   }

//   for (const item of result.history) {
//     if (item.type === 'function_call_result') {
//       const call = toolExecutions.get(item.callId);
//       if (!call) {
//         throw new Error(`Could not find tool execution for callId ${item.callId}`);
//       }

//       call.output =
//         item.output.type === 'text'
//           ? item.output.text
//           : item.output.type === 'image'
//             ? item.output.data
//             : '';
//     }
//   }

//   log('🛠️ tool executions:');
//   const executions = [...toolExecutions.values()];
//   for (const execution of executions) {
//     log(`  🔨 ${execution.name}`);
//     log(`    👉 arguments: ${JSON.stringify(execution.arguments)}`);
//     log(`    👈 output: ${execution.output}`);
//     log('\n');
//   }

//   return executions;
// }

// export function getCallToolResult<Z extends z.ZodTypeAny = z.ZodNever>(
//   toolExecution: ToolExecution,
//   schema: Z,
// ): z.infer<Z> {
//   const callToolResult = CallToolResultSchema.parse(JSON.parse(toolExecution.output));
//   invariant(callToolResult.type === 'text');
//   invariant(typeof callToolResult.text === 'string');
//   const result = schema.parse(JSON.parse(callToolResult.text));
//   return result;
// }

// export function getCallToolResultSafe<Z extends z.ZodTypeAny = z.ZodNever>(
//   toolExecution: ToolExecution,
//   schema: Z,
// ): Result<z.infer<Z>, Error> {
//   const callToolResult = CallToolResultSchema.safeParse(JSON.parse(toolExecution.output));
//   if (!callToolResult.success) {
//     return Err(callToolResult.error);
//   }

//   invariant(callToolResult.data.type === 'text');
//   invariant(typeof callToolResult.data.text === 'string');
//   const result = schema.parse(JSON.parse(callToolResult.data.text));
//   return Ok(result);
// }

export function log(message?: any, force?: boolean): void {
  if (process.env.ENABLE_LOGGING === 'true' || force) {
    console.log(message);
  }
}
