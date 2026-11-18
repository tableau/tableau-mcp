import fs from 'fs';
import http from 'http';
import https from 'https';
import { AddressInfo } from 'net';
import os from 'os';
import path from 'path';

import { Config } from '../config.js';
import { ArgsValidationError, McpSiteSettingsUnavailableError } from '../errors/mcpToolError.js';
import { WebMcpServer } from '../server.web.js';
import { startExpressServer } from './express.js';

const mocks = vi.hoisted(() => ({ registerTools: vi.fn() }));

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
      await Promise.all(
        servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
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
