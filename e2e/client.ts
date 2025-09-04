import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readdirSync } from 'fs';
import { resolve } from 'path';
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

  console.log('into build dir');
  const buildDir = resolve(__dirname, '..', 'build');
  for (const file of readdirSync(buildDir)) {
    console.log('file', file);
  }

  const transport = new StdioClientTransport({
    command: 'node',
    cwd: buildDir,
    args: ['index.js'],
    env: env ?? {},
  });

  console.log('transport created');

  const client = new Client({
    name: 'tableau-mcp-e2e-tests',
    version: '1.0.0',
  });

  console.log('client created');

  await client.connect(transport);

  console.log('client connected');
  return client;
}
