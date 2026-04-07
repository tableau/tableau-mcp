import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';

import { ToolName } from '../../src/tools/toolName.js';
import invariant from '../../src/utils/invariant.js';
import { getEnv } from '../testEnv.js';

const envSchema = z.object({
  TRANSPORT: z.enum(['stdio', 'http']).optional(),
  SERVER: z.string(),
  SITE_NAME: z.string(),
  AUTH: z.string(),
  JWT_SUB_CLAIM: z.string(),
  CONNECTED_APP_CLIENT_ID: z.string(),
  CONNECTED_APP_SECRET_ID: z.string(),
  CONNECTED_APP_SECRET_VALUE: z.string(),
});

/**
 * Lists the tools available in the MCP server.
 *
 * @returns {*}  {Promise<Array<string>>} The names of the tools available in the MCP server
 */
export async function listTools(): Promise<Array<string>> {
  const client = await getClient();
  const result = await client.listTools();
  const names = result.tools.map((tool) => tool.name);
  return names;
}

/**
 * Calls the MCP tool with the provided arguments.
 *
 * @param {ToolName} toolName The name of the tool to call
 * @param {({
 *     schema: Z;
 *     contentType?: 'text' | 'image';
 *     toolArgs?: Record<string, unknown>;
 *   })} options Additional options
 * @param options.schema The expected shape of the tool result
 * @param options.contentType The expected content type of the tool result
 * @param options.toolArgs The arguments to pass to the tool
 * @returns {*}  {Promise<z.infer<Z>>} The tool call result
 */
export async function callTool<Z extends z.ZodTypeAny = z.ZodNever>(
  toolName: ToolName,
  {
    schema,
    contentType,
    toolArgs,
  }: {
    schema: Z;
    contentType?: 'text' | 'image';
    toolArgs?: Record<string, unknown>;
  },
): Promise<z.infer<Z>> {
  contentType = contentType ?? 'text';
  toolArgs = toolArgs ?? {};

  const client = await getClient();
  const result = await client.callTool({
    name: toolName,
    arguments: toolArgs,
  });

  if (!Array.isArray(result.content)) {
    console.error(result.content);
    throw new Error('result.content must be an array');
  }

  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe(contentType);

  if (result.isError) {
    const content = result.content[0][contentType === 'text' ? 'text' : 'data'];
    console.error(content);
    throw new Error(content);
  }

  if (contentType === 'text') {
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

/**
 * Gets a new instance of an MCP client using stdio transport.
 *
 * @returns {*}  {Promise<Client>} The MCP client
 */
export async function getClient(): Promise<Client> {
  // https://github.com/nodejs/node/issues/55374
  const env = { ...getEnv(envSchema), PATH: process.env.PATH ?? '' };

  if (env.TRANSPORT && env.TRANSPORT !== 'stdio') {
    throw new Error('Only stdio transport is currently supported for e2e tests');
  }

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['build/index.js'],
    env: env ?? {},
  });

  const client = new Client({
    name: 'tableau-mcp-e2e-tests',
    version: '1.0.0',
  });

  await client.connect(transport);
  return client;
}
