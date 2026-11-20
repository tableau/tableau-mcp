import { McpServer } from '@modelcontextprotocol/server';
import fs from 'fs';
import http from 'http';
import https from 'https';
import { AddressInfo } from 'net';
import os from 'os';
import path from 'path';

import { Config } from '../config.js';
import { ArgsValidationError, McpSiteSettingsUnavailableError } from '../errors/mcpToolError.js';
import { log } from '../logging/logger.js';
import { WebMcpServer } from '../server.web.js';
import { startExpressServer } from './express.js';

const mocks = vi.hoisted(() => ({
  registerTools: vi.fn(),
  enabledFeatures: new Set<string>(),
  gateFails: false,
}));

vi.mock('../features/init.js', () => ({
  getFeatureGate: () => ({
    isFeatureEnabled: async (name: string) => {
      if (mocks.gateFails) throw new Error('gate unavailable');
      return mocks.enabledFeatures.has(name);
    },
  }),
}));
// The 2026-07-28 handler checks `instanceof McpServer`, so the end-to-end tests need the real class.
vi.unmock('@modelcontextprotocol/server');
vi.mock('../server.web.js', () => ({ WebMcpServer: vi.fn() }));
vi.mock('../logging/logger.js');

// Only the fields startExpressServer reads while wiring up an unauthenticated server.
function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    httpPort: 0, // let the OS pick a free port
    sslKey: '',
    sslCert: '',
    corsOriginConfig: true,
    enablePassthroughAuth: false,
    disableSessionManagement: true,
    oauth: { enabled: false },
    ...overrides,
  } as Config;
}

describe('startExpressServer bind host', () => {
  const servers: Array<http.Server> = [];
  const tempDirs: Array<string> = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    tempDirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
    await Promise.all(
      servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
    );
  });

  it('binds http to the given host and reports it in the url', async () => {
    const { server, url } = await startExpressServer({
      basePath: 'tableau-mcp',
      config: makeConfig(),
      logLevel: 'debug',
      host: '127.0.0.1',
    });
    servers.push(server);

    expect((server.address() as AddressInfo).address).toBe('127.0.0.1');
    // 127.0.0.1 rather than localhost: localhost can resolve to ::1, where nothing is listening.
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/tableau-mcp$/);
  });

  it('brackets an IPv6 host in the url', async () => {
    const { server, url } = await startExpressServer({
      basePath: 'tableau-mcp',
      config: makeConfig(),
      logLevel: 'debug',
      host: '::1',
    });
    servers.push(server);

    expect(url).toMatch(/^http:\/\/\[::1\]:\d+\/tableau-mcp$/);
  });

  it.each([undefined, ''])('binds http to all interfaces when host is %j', async (host) => {
    const { server, url } = await startExpressServer({
      basePath: 'tableau-mcp',
      config: makeConfig(),
      logLevel: 'debug',
      host,
    });
    servers.push(server);

    // The wildcard bind is what the Docker image and Heroku rely on.
    expect(['::', '0.0.0.0']).toContain((server.address() as AddressInfo).address);
    expect(url).toMatch(/^http:\/\/localhost:\d+\/tableau-mcp$/);
  });

  it('binds https to the given host and reports it in the url', async () => {
    // The files only need to exist; https.createServer is stubbed below so they're never parsed.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'express-test-'));
    tempDirs.push(dir);
    const sslKey = path.join(dir, 'key.pem');
    const sslCert = path.join(dir, 'cert.pem');
    fs.writeFileSync(sslKey, 'stub');
    fs.writeFileSync(sslCert, 'stub');
    // The repo has no TLS fixtures, so serve plain http through the https code path.
    vi.spyOn(https, 'createServer').mockImplementation(((_options: unknown, app: never) =>
      http.createServer(app)) as never);

    const { server, url } = await startExpressServer({
      basePath: 'tableau-mcp',
      config: makeConfig({ sslKey, sslCert }),
      logLevel: 'debug',
      host: '127.0.0.1',
    });
    servers.push(server);

    expect((server.address() as AddressInfo).address).toBe('127.0.0.1');
    expect(url).toMatch(/^https:\/\/127\.0\.0\.1:\d+\/tableau-mcp$/);
  });
});

describe.each([false, true])(
  'startExpressServer MCP request errors (stateless: %s)',
  (stateless) => {
    const servers: Array<http.Server> = [];

    // Set per test: afterEach's restoreAllMocks clears a mockImplementation. A function, not an
    // arrow: express calls `new WebMcpServer(...)`, and vitest 5 rejects `new` on an arrow mock.
    beforeEach(() => {
      vi.mocked(WebMcpServer).mockImplementation(function () {
        return {
          registerTools: mocks.registerTools,
          mcpServer: { server: { setRequestHandler: vi.fn() }, connect: vi.fn(), close: vi.fn() },
        } as never;
      });
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      mocks.enabledFeatures.clear();
      mocks.gateFails = false;
      await Promise.all(
        servers.splice(0).map((server) => {
          // The unanswered initialize in the log test would otherwise hold close() open.
          server.closeAllConnections();
          return new Promise((resolve) => server.close(resolve));
        }),
      );
    });

    const postInitialize = async (): Promise<Response> => {
      const { server } = await startExpressServer({
        basePath: 'tableau-mcp',
        config: makeConfig({ disableSessionManagement: stateless }),
        logLevel: 'debug',
        host: '127.0.0.1',
      });
      servers.push(server);
      const { port } = server.address() as AddressInfo;

      return fetch(`http://127.0.0.1:${port}/tableau-mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '1.0.0' },
          },
        }),
      });
    };

    it.each([
      [400, -32000],
      [404, -32000],
      [500, -32603],
      [502, -32603],
      [503, -32603],
    ])(
      'answers with the status a site settings error carries (%i) when setting up a session fails',
      async (statusCode, jsonRpcCode) => {
        mocks.registerTools.mockRejectedValue(
          new McpSiteSettingsUnavailableError('Could not get the MCP settings.', statusCode),
        );

        const response = await postInitialize();

        expect(response.status).toBe(statusCode);
        expect(await response.json()).toMatchObject({
          jsonrpc: '2.0',
          error: { code: jsonRpcCode, message: 'Could not get the MCP settings.' },
          id: null,
        });
      },
    );

    it('logs the connecting client once on initialize', async () => {
      mocks.registerTools.mockResolvedValue(undefined);
      vi.mocked(log).mockClear();

      // The mocked server never answers, so only wait for the log, not the response.
      void postInitialize().catch(() => {});
      await vi.waitFor(() =>
        expect(
          vi.mocked(log).mock.calls.filter(([e]) => e.message === 'MCP client initialized'),
        ).toHaveLength(1),
      );

      expect(log).toHaveBeenCalledWith({
        message: 'MCP client initialized',
        level: 'info',
        logger: 'http',
        data: {
          protocolVersion: '2025-06-18',
          clientInfo: { name: 'test-client', version: '1.0.0' },
          capabilities: {},
          elicitationSupported: false,
        },
      });
    });

    const post2026ToolsList = async (clientName: string): Promise<Response> => {
      const { server } = await startExpressServer({
        basePath: 'tableau-mcp',
        config: makeConfig({ disableSessionManagement: stateless }),
        logLevel: 'debug',
        host: '127.0.0.1',
      });
      servers.push(server);
      const { port } = server.address() as AddressInfo;

      return fetch(`http://127.0.0.1:${port}/tableau-mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Mcp-Method': 'tools/list',
          'MCP-Protocol-Version': '2026-07-28',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': {
                name: `${clientName}-${stateless}`,
                version: '1.0.0',
              },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        }),
      });
    };

    // A real McpServer, so the request is answered end to end on either path.
    const serveRealMcpServer = (): void => {
      vi.mocked(WebMcpServer).mockImplementation(function () {
        const mcpServer = new McpServer({ name: 'test', version: '0.0.0' });
        mcpServer.registerTool('echo', { description: 'Echo' }, async () => ({ content: [] }));
        return { registerTools: mocks.registerTools, mcpServer } as never;
      });
    };

    const builtFromEnvelope = (clientName: string): boolean =>
      vi
        .mocked(WebMcpServer)
        .mock.calls.some(([options]) => options?.clientInfo?.name === `${clientName}-${stateless}`);

    it('answers a 2026-07-28 tools/list from a server built from the request envelope', async () => {
      mocks.enabledFeatures.add('mcp-protocol-2026');
      mocks.registerTools.mockResolvedValue(undefined);
      serveRealMcpServer();

      const response = await post2026ToolsList('envelope');

      expect(response.status).toBe(200);
      expect(await response.text()).toContain('"name":"echo"');
      expect(builtFromEnvelope('envelope')).toBe(true);
    });

    it('keeps a 2026-07-28 request on the 2025 path with mcp-protocol-2026 off', async () => {
      mocks.registerTools.mockResolvedValue(undefined);
      serveRealMcpServer();
      vi.mocked(log).mockClear();

      const response = await post2026ToolsList('flag-off');
      await response.text();

      expect(builtFromEnvelope('flag-off')).toBe(false);
      expect(vi.mocked(log).mock.calls.some(([e]) => e.message === 'MCP client initialized')).toBe(
        false,
      );
    });

    it('keeps a 2026-07-28 request on the 2025 path when the gate lookup fails', async () => {
      mocks.enabledFeatures.add('mcp-protocol-2026');
      mocks.gateFails = true;
      mocks.registerTools.mockResolvedValue(undefined);
      serveRealMcpServer();

      const response = await post2026ToolsList('gate-fails');
      await response.text();

      expect(builtFromEnvelope('gate-fails')).toBe(false);
    });

    it('answers a site settings 401 on a 2026-07-28 request with the OAuth challenge', async () => {
      mocks.enabledFeatures.add('mcp-protocol-2026');
      mocks.registerTools.mockRejectedValue(
        new McpSiteSettingsUnavailableError('Could not get the MCP settings.', 401),
      );

      const response = await post2026ToolsList('challenge');

      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toContain('error="invalid_token"');
      expect(await response.json()).toMatchObject({ error: 'invalid_token' });
    });

    it('keeps a site settings 4xx a 4xx on a 2026-07-28 request', async () => {
      mocks.enabledFeatures.add('mcp-protocol-2026');
      mocks.registerTools.mockRejectedValue(
        new McpSiteSettingsUnavailableError('Could not get the MCP settings.', 404),
      );

      const response = await post2026ToolsList('not-found');

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        error: { code: -32000, message: 'Could not get the MCP settings.' },
      });
    });

    it('logs a 2026-07-28 client once across requests, and a different client separately', async () => {
      mocks.enabledFeatures.add('mcp-protocol-2026');
      mocks.registerTools.mockResolvedValue(undefined);
      vi.mocked(log).mockClear();
      const { server } = await startExpressServer({
        basePath: 'tableau-mcp',
        config: makeConfig({ disableSessionManagement: stateless }),
        logLevel: 'debug',
        host: '127.0.0.1',
      });
      servers.push(server);
      const { port } = server.address() as AddressInfo;

      // The dedup set is module-level, so each describe.each run needs its own client names.
      const post = (client: string, capabilities: object = {}): Promise<unknown> =>
        fetch(`http://127.0.0.1:${port}/tableau-mcp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'Mcp-Method': 'tools/list',
            'MCP-Protocol-Version': '2026-07-28',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list',
            params: {
              _meta: {
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientInfo': {
                  name: `${client}-${stateless}`,
                  version: '1.0.0',
                },
                'io.modelcontextprotocol/clientCapabilities': capabilities,
              },
            },
          }),
        }).catch(() => {});
      const initLogs = (): Array<unknown> =>
        vi.mocked(log).mock.calls.filter(([e]) => e.message === 'MCP client initialized');

      await post('modern-a');
      await post('modern-a');
      expect(initLogs()).toHaveLength(1);
      expect(log).toHaveBeenCalledWith({
        message: 'MCP client initialized',
        level: 'info',
        logger: 'http',
        data: {
          protocolVersion: '2026-07-28',
          clientInfo: { name: `modern-a-${stateless}`, version: '1.0.0' },
          capabilities: {},
          elicitationSupported: false,
        },
      });

      await post('modern-b');
      expect(initLogs()).toHaveLength(2);

      // A capability change on a known client is logged again.
      await post('modern-a', { elicitation: {} });
      expect(initLogs()).toHaveLength(3);
    });

    it('answers a site settings 401 with the OAuth challenge, so the client signs in again', async () => {
      mocks.registerTools.mockRejectedValue(
        new McpSiteSettingsUnavailableError('Could not get the MCP settings.', 401),
      );

      const response = await postInitialize();

      expect(response.status).toBe(401);
      const challenge = response.headers.get('www-authenticate');
      expect(challenge).toMatch(
        /^Bearer realm="MCP", resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource"/,
      );
      expect(challenge).toContain('error="invalid_token"');
      expect(await response.json()).toMatchObject({ error: 'invalid_token' });
    });

    it.each([
      ['an untyped error', new Error('secret internals')],
      ['any other typed error', new ArgsValidationError('secret internals')],
    ])('answers 500 with a generic message for %s', async (_, error) => {
      mocks.registerTools.mockRejectedValue(error);

      const response = await postInitialize();

      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({
        error: { code: -32603, message: 'Internal server error' },
      });
    });
  },
);
