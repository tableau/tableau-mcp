import {
  createMcpHandler,
  InMemoryTransport,
  McpServer,
  PROTOCOL_VERSION_META_KEY,
} from '@modelcontextprotocol/server';
import { z } from 'zod';

import { getRequestFields } from '../tools/toolContext.js';
import { getMockRequestHandlerExtra } from '../tools/web/toolContext.mock.js';
import { getProtocolVersionForTelemetry } from './protocolVersion.js';

vi.unmock('@modelcontextprotocol/server');

describe('getProtocolVersionForTelemetry', () => {
  it('uses the legacy HTTP protocol header without an initialize handshake', () => {
    const extra = getMockRequestHandlerExtra({
      requestInfo: { headers: new Headers({ 'MCP-Protocol-Version': '2025-06-18' }) },
    });

    expect(getProtocolVersionForTelemetry(extra)).toBe('2025-06-18');
  });

  it('uses the modern envelope exposed by the SDK and preserves it in the tool context', async () => {
    let observed: string | undefined;
    const handler = createMcpHandler(
      () => {
        const server = new McpServer({ name: 'test', version: '1.0.0' });
        server.registerTool('probe', { inputSchema: z.object({}) }, async (_args, ctx) => {
          const fields = getRequestFields(ctx);
          expect(ctx.mcpReq._meta ?? {}).not.toHaveProperty(PROTOCOL_VERSION_META_KEY);
          expect(fields.protocolVersion).toBe('2026-07-28');
          observed = getProtocolVersionForTelemetry({
            ...getMockRequestHandlerExtra(),
            ...fields,
            // Verify the envelope wins without relying on the mirrored HTTP header.
            requestInfo: undefined,
          });
          return { content: [] };
        });
        return server;
      },
      { legacy: 'reject' },
    );

    const response = await handler.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Mcp-Method': 'tools/call',
          'Mcp-Name': 'probe',
          'MCP-Protocol-Version': '2026-07-28',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'probe',
            arguments: {},
            _meta: {
              [PROTOCOL_VERSION_META_KEY]: '2026-07-28',
              'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1.0.0' },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: { content: [] } });
    expect(observed).toBe('2026-07-28');
  });

  it('uses the negotiated legacy version on a connection without HTTP headers', async () => {
    const extra = getMockRequestHandlerExtra();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await extra.server.mcpServer.connect(serverTransport);

    try {
      const initialized = new Promise<void>((resolve) => {
        clientTransport.onmessage = () => resolve();
      });
      await clientTransport.start();
      await clientTransport.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2099-01-01',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
      });
      await initialized;

      const negotiated = extra.server.mcpServer.server.getNegotiatedProtocolVersion();
      expect(negotiated).toBe('2025-11-25');
      expect(getProtocolVersionForTelemetry(extra)).toBe(negotiated);
    } finally {
      await extra.server.mcpServer.close();
      await clientTransport.close();
    }
  });

  it('prefers request metadata over the HTTP header', () => {
    const extra = getMockRequestHandlerExtra({
      protocolVersion: '2026-07-28',
      requestInfo: { headers: new Headers({ 'MCP-Protocol-Version': '2025-11-25' }) },
    });

    expect(getProtocolVersionForTelemetry(extra)).toBe('2026-07-28');
  });

  it('reports unknown when no version is available', () => {
    expect(getProtocolVersionForTelemetry(getMockRequestHandlerExtra())).toBe('unknown');
  });

  it.each([
    ['empty', ''],
    ['SDK semver', '2.4.0'],
    ['arbitrary text', 'invalid'],
    ['trailing newline', '2026-07-28\n'],
    ['oversized', 'x'.repeat(10000)],
  ])('does not forward malformed protocol metadata (%s)', (_label, protocolVersion) => {
    expect(getProtocolVersionForTelemetry(getMockRequestHandlerExtra({ protocolVersion }))).toBe(
      'unknown',
    );
  });
});
