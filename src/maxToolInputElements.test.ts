import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { MAX_TOOL_INPUT_ELEMENTS } from './maxToolInputElements.js';
import { WebMcpServer } from './server.web.js';

// The shared test setup replaces McpServer with a bare stub (see src/testSetup.ts); these tests
// must drive the real SDK so the cap's enforcement is what is measured.
vi.unmock('@modelcontextprotocol/sdk/server/mcp.js');

// Literal values so the regression test keeps pinning the real boundary even if the exported
// constant is edited: a lower cap must fail the 2,100-element call and a higher one must fail the
// 2,101-element refusal.
const AT_CAP_ELEMENTS = 2_100;
const OVER_CAP_ELEMENTS = 2_101;

function extraKeys(count: number): Record<string, string> {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [`extra${index}`, 'x']));
}

async function startProbeServer(): Promise<{
  client: Client;
  mcpServer: McpServer;
  handled: string[];
}> {
  // The application's own server construction (src/server.ts), not a hand-built McpServer:
  // this is the construction site whose cap the regression test must defend.
  const server = new WebMcpServer();
  const mcpServer = server.mcpServer;
  const handled: string[] = [];
  mcpServer.registerTool(
    'probe',
    {
      description: 'Reports the values that reached the handler.',
      inputSchema: { values: z.array(z.string()) },
    },
    async ({ values }) => {
      handled.push(`values=${values.length}`);
      return { content: [{ type: 'text', text: `handled values=${values.length}` }] };
    },
  );

  const client = new Client({ name: 'tool-input-cap-probe-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, mcpServer, handled };
}

describe('MAX_TOOL_INPUT_ELEMENTS', () => {
  it('is pinned at 2,100 counted elements', () => {
    expect(MAX_TOOL_INPUT_ELEMENTS).toBe(AT_CAP_ELEMENTS);
  });

  it('is applied by the McpServer that the default web server constructs', () => {
    const server = new WebMcpServer();
    expect(
      (server.mcpServer as unknown as { _maxToolInputElements?: number })._maxToolInputElements,
    ).toBe(AT_CAP_ELEMENTS);
  });

  it('accepts 2,100 counted array elements and refuses 2,101 before the handler', async () => {
    const { client, mcpServer, handled } = await startProbeServer();
    try {
      // The SDK counts own object keys plus array elements, the arguments object included:
      // {values: [...N]} is N + 1 counted elements, so N = 2,099 is exactly 2,100 counted.
      const valuesAtCap = Array.from({ length: AT_CAP_ELEMENTS - 1 }, () => 'x');
      const atCap = await client.callTool({ name: 'probe', arguments: { values: valuesAtCap } });
      expect(atCap.isError).toBeFalsy();
      expect((atCap.content as Array<{ type: string; text: string }>)[0].text).toBe(
        `handled values=${valuesAtCap.length}`,
      );
      expect(handled).toEqual([`values=${valuesAtCap.length}`]);

      const valuesOverCap = Array.from({ length: OVER_CAP_ELEMENTS - 1 }, () => 'x');
      const overCap = await client.callTool({
        name: 'probe',
        arguments: { values: valuesOverCap },
      });
      expect(overCap.isError).toBe(true);
      expect((overCap.content as Array<{ type: string; text: string }>)[0].text).toContain(
        `arguments contain more than the maximum of ${AT_CAP_ELEMENTS} elements`,
      );
      // A refused call is rejected before zod or the handler runs.
      expect(handled).toEqual([`values=${valuesAtCap.length}`]);
    } finally {
      await client.close();
      await mcpServer.close();
    }
  });

  it('counts object keys toward the same boundary', async () => {
    const { client, mcpServer, handled } = await startProbeServer();
    try {
      // {values: [], ...N extra keys} is N + 1 counted keys, the arguments object included.
      const atCap = await client.callTool({
        name: 'probe',
        arguments: { values: [], ...extraKeys(AT_CAP_ELEMENTS - 1) },
      });
      expect(atCap.isError).toBeFalsy();
      expect(handled).toEqual(['values=0']);

      const overCap = await client.callTool({
        name: 'probe',
        arguments: { values: [], ...extraKeys(OVER_CAP_ELEMENTS - 1) },
      });
      expect(overCap.isError).toBe(true);
      expect((overCap.content as Array<{ type: string; text: string }>)[0].text).toContain(
        `arguments contain more than the maximum of ${AT_CAP_ELEMENTS} elements`,
      );
      expect(handled).toEqual(['values=0']);
    } finally {
      await client.close();
      await mcpServer.close();
    }
  });
});
