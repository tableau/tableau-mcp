import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  Agent,
  getAllMcpTools,
  MCPServerStdio,
  OpenAIChatCompletionsModel,
  StreamedRunResult,
  withTrace,
} from '@openai/agents';
import { existsSync } from 'fs';
import OpenAI from 'openai';
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

// Spawns the desktop build (build/index.desktop.js) instead of the web build. Desktop tools are
// only in that bundle. It boots on stdio with no SERVER/AUTH/discovery env and registers its tools
// statically, so an agent can list and call them (emitting arguments we grade) without a live
// Tableau Desktop — the call errors at execution, but the function_call arguments are still recorded.
export async function getDesktopMcpServer(): Promise<MCPServerStdio> {
  // DESKTOP_MCP_BUNDLE lets the A/B run point at a base-commit bundle without onClear;
  // defaults to the current build. Same harness, same prompts — only the schema differs.
  const bundle = process.env.DESKTOP_MCP_BUNDLE || 'build/index.desktop.js';
  if (!existsSync(bundle)) {
    throw new Error(`${bundle} not found. Run \`npm run build:desktop\` before the desktop evals.`);
  }

  const mcpServer = new MCPServerStdio({
    command: 'node',
    args: [bundle],
    env: { TRANSPORT: 'stdio' },
    cacheToolsList: true,
  });

  await mcpServer.connect();
  return mcpServer;
}

export async function getAgent({
  systemPrompt,
  model,
  mcpServer,
  toolAllowList,
}: {
  systemPrompt: string;
  model: string;
  mcpServer?: MCPServerStdio;
  // Restrict the agent to these tools, by their recorded (underscored) names — e.g.
  // ['author_action']. The desktop build exposes ~74 tools; registered both ways (see below)
  // that is 148, over the model gateway's 128-tool cap. An allow-list also sharpens an arg-only
  // eval: with one tool and toolChoice:'required', the grade is purely whether the description
  // steers the arguments, not whether the model found the tool.
  toolAllowList?: Array<string>;
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

    // Allow-listed: expose only those tools, un-prefixed, and skip mcpServers so the server
    // doesn't re-add every tool. The tools invoke through the server captured in their closure.
    if (toolAllowList) {
      const tools = (await getAllMcpTools([mcpServer])).filter((tool) =>
        toolAllowList.includes(tool.name),
      );
      return new Agent({ ...agentOptions, tools, modelSettings: { toolChoice: 'required' } });
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
): Result<z.infer<Z>, Error> {
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
