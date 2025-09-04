import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';

import { ToolName } from '../src/tools/toolName.js';
import invariant from '../src/utils/invariant.js';
import { getDefaultEnv } from './testEnv.js';

export async function listTools(): Promise<Array<string>> {
  const client = await getClient();
  const result = await client.listTools();
  const names = result.tools.map((tool) => tool.name);
  return names;
}

export async function callTool<Z extends z.ZodTypeAny = z.ZodNever>(
  toolName: ToolName,
  {
    schema,
    expectedContentType,
    env,
    toolArgs,
  }: {
    schema: Z;
    expectedContentType?: 'text' | 'image';
    env?: Record<string, string>;
    toolArgs?: Record<string, unknown>;
  },
): Promise<z.infer<Z>> {
  expectedContentType = expectedContentType ?? 'text';
  toolArgs = toolArgs ?? {};

  const client = await getClient(env);
  const result = await client.callTool({
    name: toolName,
    arguments: toolArgs,
  });

  if (!Array.isArray(result.content)) {
    console.error(result.content);
    throw new Error('result.content must be an array');
  }

  if (result.isError) {
    const content = result.content[0][expectedContentType === 'text' ? 'text' : 'data'];
    console.error(content);
    throw new Error(content);
  }

  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe(expectedContentType);

  if (expectedContentType === 'text') {
    const text = result.content[0].text;
    invariant(typeof text === 'string');
    const response = schema.parse(JSON.parse(text));
    return response;
  } else {
    const content = result.content[0].data;
    invariant(typeof content === 'string');
    const response = schema.parse(content);
    return response;
  }
}

export async function getClient(env?: Record<string, string>): Promise<Client> {
  env = env ?? getDefaultEnv();

  // https://github.com/nodejs/node/issues/55374
  env.PATH = process.env.PATH ?? '';

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['build/index.js'],
    env: env ?? {},
  });

  const client = new Client({
    name: 'tableau-mcp-e2e-tests',
    version: '1.0.0',
    capabilities: {
      listTools: true,
      callTool: true,
    },
  });

  await client.connect(transport);
  return client;
}
