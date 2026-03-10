import { MultiServerMCPClient, StdioConnection } from '@langchain/mcp-adapters';
import { ChatOpenAI } from '@langchain/openai';
import { AIMessage, createAgent, HumanMessage, SystemMessage, ToolMessage } from 'langchain';

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

type Message = AIMessage | HumanMessage | SystemMessage | ToolMessage;
type Agent = ReturnType<typeof createAgent>;

export function getApiKey(): string {
  const { OPENAI_API_KEY } = process.env;

  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set.');
  }

  return OPENAI_API_KEY;
}

export function getModel(): string {
  return process.env.EVAL_TEST_MODEL || DEFAULT_MODEL;
}

export function getMcpServer(env?: Record<string, string>): StdioConnection {
  const mcpServer: StdioConnection = {
    command: 'node',
    args: ['build/index.js'],
    env,
  };

  return mcpServer;
}

export async function getAgent({
  model,
  mcpServer,
}: {
  model: string;
  mcpServer?: StdioConnection;
}): Promise<{ agent: Agent; client?: MultiServerMCPClient }> {
  const agentOptions = {
    name: 'Assistant with Tableau MCP tools',
    model: new ChatOpenAI({
      model,
      configuration: {
        apiKey: getApiKey(),
        baseURL: process.env.OPENAI_BASE_URL,
      },
    }),
  };

  if (!mcpServer) {
    return { agent: createAgent({ ...agentOptions }) };
  }

  const client = new MultiServerMCPClient({
    tableau: mcpServer,
  });

  const tools = await client.getTools();
  return {
    agent: createAgent({ ...agentOptions, tools }),
    client,
  };
}

export async function prompt(agent: Agent, content: string): Promise<Array<Message>> {
  console.log(`Invoking agent with input: ${content}...`);

  const start = performance.now();

  const { messages } = (await agent.invoke({
    messages: [{ role: 'user', content }],
  })) as { messages: Array<Message> };

  const end = performance.now();

  const duration = Math.round(end - start);
  console.log(`Agent response received after ${duration}ms`);

  return messages;
}

export function log(message?: any, force?: boolean): void {
  if (process.env.ENABLE_LOGGING === 'true' || force) {
    console.log(message);
  }
}
