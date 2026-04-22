import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Implementation } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { Variant } from '../../src/scripts/variants.js';
import { WebToolName } from '../../src/tools/web/toolName.js';
import invariant from '../../src/utils/invariant.js';
import { getDefaultEnv } from '../testEnv.js';

export class McpClient {
  private readonly transport: StdioClientTransport;

  readonly client: Client;

  constructor(args: { variant?: Variant; env?: Record<string, string> } = {}) {
    let { variant, env } = args ?? {};
    variant = variant ?? 'default';
    env = env ?? getDefaultEnv();

    // https://github.com/nodejs/node/issues/55374
    env.PATH = process.env.PATH ?? '';

    this.transport = new StdioClientTransport({
      command: 'node',
      args: [variant === 'default' ? 'build/index.js' : `build/index.${variant}.js`],
      env: env ?? {},
    });

    this.client = new Client({
      name: 'tableau-mcp-e2e-tests',
      version: '1.0.0',
    });
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
  }

  async close(): Promise<void> {
    await this.client.close();
    await this.transport.close();
  }

  async getServerVersion(): Promise<Implementation | undefined> {
    return this.client.getServerVersion();
  }

  async listTools(): Promise<Array<string>> {
    return (await this.client.listTools()).tools.map((tool) => tool.name);
  }

  /**
   * Calls the MCP tool with the provided arguments.
   *
   * @param {WebToolName} toolName The name of the tool to call
   * @param {({
   *     schema: Z;
   *     contentType?: 'text' | 'image';
   *     env?: Record<string, string>;
   *     toolArgs?: Record<string, unknown>;
   *   })} options Additional options
   * @param options.schema The expected shape of the tool result
   * @param options.contentType The expected content type of the tool result
   * @param options.env The environment to use when spawning the node process running the MCP server
   * @param options.toolArgs The arguments to pass to the tool
   * @returns {*}  {Promise<z.infer<Z>>} The tool call result
   */
  async callTool<Z extends z.ZodTypeAny = z.ZodNever>(
    toolName: WebToolName,
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

    const result = await this.client.callTool({
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
}
