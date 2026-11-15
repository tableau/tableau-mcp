import fs from 'fs';
import http from 'http';
import https from 'https';
import { AddressInfo } from 'net';
import os from 'os';
import path from 'path';

import { Config } from '../config.js';
import { startExpressServer } from './express.js';

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
