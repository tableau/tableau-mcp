import { ExchangeMcpServer } from './server.exchange.js';
import { getMockExchangeServer } from './tools/exchange/toolContext.mock.js';
import { exchangeToolNames } from './tools/exchange/toolName.js';

describe('ExchangeMcpServer', () => {
  it('registers the Exchange tools with schemas, read-only except download', async () => {
    const server = getMockExchangeServer();
    await server.registerTools();
    expect(server).toBeInstanceOf(ExchangeMcpServer);
    const register = vi.mocked(server.mcpServer.registerTool);
    expect(register).toHaveBeenCalledTimes(5);
    const registrations = register.mock.calls as unknown as Array<
      [string, { annotations?: unknown; inputSchema?: unknown; outputSchema?: unknown }]
    >;
    expect(registrations.map(([name]) => name)).toEqual(exchangeToolNames);
    for (const [name, definition] of registrations) {
      expect(definition).toMatchObject({
        annotations: {
          readOnlyHint: name !== 'download-exchange-asset',
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      });
      expect(definition.inputSchema).toBeDefined();
      expect(definition.outputSchema).toBeDefined();
    }
    expect(server.mcpServer.registerResource).not.toHaveBeenCalled();
  });
});
