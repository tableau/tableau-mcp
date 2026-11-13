import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ChildProcess, spawn } from 'child_process';
import express from 'express';
import { createServer, Server } from 'http';
import { generateKeyPair, jwtVerify, SignJWT } from 'jose';
import { AddressInfo } from 'net';

const audience = 'eas-protocol-client';
const issuer = 'https://synthetic-issuer.example';
const sessions = new Map<string, { username: string; scopes: string }>();
const credentialsSeen: string[] = [];
const exchanges: string[] = [];
const settingsDenials: string[] = [];
const apiCalls: Array<{ username: string; site: string }> = [];
let sequence = 0;
let upstream: Server;
let process: ChildProcess;
let endpoint: string;
let output = '';
let sign: (claims?: Record<string, unknown>) => Promise<string>;

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return (server.address() as AddressInfo).port;
}
async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
async function connect(token: string): Promise<{
  client: Client;
  transport: StreamableHTTPClientTransport;
  headers: { Authorization: string };
}> {
  const client = new Client({ name: 'eas-protocol-test', version: '1.0' });
  const headers = { Authorization: `Bearer ${token}` };
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers },
  });
  await client.connect(transport);
  return { client, transport, headers };
}

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  sign = (claims = {}) =>
    new SignJWT({
      external_username: 'viewer-a',
      sub: 'different-user',
      scope: 'openid',
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(issuer)
      .setAudience(typeof claims.aud === 'string' ? claims.aud : audience)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
  const app = express();
  app.use(express.json());
  app.get('/api/:version/serverinfo', (_req, res) =>
    res.json({
      serverInfo: {
        productVersion: { value: '2025.1.0', build: '20251.00.0000.0000' },
        restApiVersion: '3.30',
      },
    }),
  );
  app.post('/api/:version/auth/signin', async (req, res) => {
    try {
      const { jwt, site, ...other } = req.body.credentials;
      expect(other).toEqual({});
      expect(site.contentUrl).toBe('eas-site');
      exchanges.push(jwt);
      const { payload } = await jwtVerify(jwt, publicKey, { issuer, audience });
      if (!['viewer-a', 'viewer-b'].includes(String(payload.external_username))) {
        res.sendStatus(401);
        return;
      }
      const token = `opaque-session-${++sequence}`;
      sessions.set(token, {
        username: String(payload.external_username),
        scopes: String(payload.scope),
      });
      credentialsSeen.push(token);
      res.json({
        credentials: {
          token,
          user: { id: String(payload.external_username) },
          site: { id: 'eas-site-id' },
        },
      });
    } catch {
      res.sendStatus(401);
    }
  });
  app.post('/api/:version/auth/signout', (req, res) => {
    sessions.delete(String(req.headers['x-tableau-auth']));
    res.status(204).end();
  });
  app.get('/api/:version/sessions/current', (req, res) => {
    const session = sessions.get(String(req.headers['x-tableau-auth']));
    if (!session) {
      res.sendStatus(401);
      return;
    }
    res.json({
      session: {
        user: { id: session.username, name: session.username },
        site: { id: 'eas-site-id', name: 'EAS site', contentUrl: 'eas-site' },
      },
    });
  });
  app.get('/api/:version/sites/:site/settings/mcp', (req, res) => {
    const session = sessions.get(String(req.headers['x-tableau-auth']));
    if (!session) {
      res.sendStatus(401);
      return;
    }
    if (
      session.scopes.includes('tableau:') &&
      !session.scopes.includes('tableau:mcp_site_settings:read')
    ) {
      settingsDenials.push(session.username);
      res.status(401).json({
        error: {
          code: '401002',
          summary: 'Unauthorized',
          detail: 'Synthetic startup scope denial',
        },
      });
      return;
    }
    res.json({ settings: [] });
  });
  app.get('/api/:version/sites/:site/projects', (req, res) => {
    const session = sessions.get(String(req.headers['x-tableau-auth']));
    if (!session || req.params.site !== 'eas-site-id') {
      res.sendStatus(401);
      return;
    }
    apiCalls.push({ username: session.username, site: req.params.site });
    if (session.scopes.includes('tableau:views:download')) {
      res.status(403).json({
        error: { code: '403004', summary: 'Forbidden', detail: 'Synthetic narrow scope' },
      });
      return;
    }
    res.json({
      pagination: { pageNumber: '1', pageSize: '1000', totalAvailable: '1' },
      projects: { project: [{ id: `project-${session.username}`, name: 'Default' }] },
    });
  });
  app.use((_req, res) => res.sendStatus(404));
  upstream = createServer(app);
  const upstreamPort = await listen(upstream);
  const reservation = createServer();
  const port = await listen(reservation);
  await close(reservation);
  endpoint = `http://127.0.0.1:${port}/tableau-mcp`;
  const env = { ...globalThis.process.env };
  for (const key of Object.keys(env)) {
    if (
      /^(PAT_|UAT_|CONNECTED_APP_|OAUTH_|JWT_|ENABLE_PASSTHROUGH_AUTH|DANGEROUSLY_DISABLE_OAUTH)/.test(
        key,
      )
    )
      delete env[key];
  }
  process = spawn(globalThis.process.execPath, ['build/index.js'], {
    cwd: globalThis.process.cwd(),
    env: {
      ...env,
      AUTH: 'server-eas',
      TRANSPORT: 'http',
      HTTP_HOST: '127.0.0.1',
      PORT: String(port),
      SERVER: `http://127.0.0.1:${upstreamPort}`,
      SITE_NAME: 'eas-site',
      OAUTH_GLOBAL_RESOURCE_URIS: audience,
      INCLUDE_TOOLS: 'list-projects',
      ENABLE_MCP_SITE_SETTINGS: 'true',
      PRODUCT_TELEMETRY_ENABLED: 'false',
      LOG_LEVEL: 'error',
      DEFAULT_NOTIFICATION_LEVEL: 'error',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  process.stdout?.on('data', (data) => {
    output += String(data);
  });
  process.stderr?.on('data', (data) => {
    output += String(data);
  });
  await vi.waitFor(
    async () => {
      if (process.exitCode !== null) throw new Error(`MCP exited: ${output.slice(-500)}`);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(response.status).toBe(401);
    },
    { timeout: 20_000, interval: 100 },
  );
});

afterAll(async () => {
  process?.kill('SIGTERM');
  if (process && process.exitCode === null)
    await new Promise<void>((resolve) => process.once('exit', () => resolve()));
  if (upstream) await close(upstream);
});

it('returns a permission denial rather than a server error when a narrow session cannot read startup settings', async () => {
  const token = await sign({ scope: 'openid tableau:content:read' });
  await expect(connect(token)).rejects.toMatchObject({ code: 403 });
  expect(exchanges).toEqual([token]);
  expect(settingsDenials).toEqual(['viewer-a']);
  expect(apiCalls).toEqual([]);
  await vi.waitFor(() => expect(sessions.size).toBe(0));
});

it('initializes, lists tools, and performs a protected read with the original identity-only JWT', async () => {
  const token = await sign();
  const exchangeStart = exchanges.length;
  const { client } = await connect(token);
  try {
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['list-projects']);
    const result = await client.callTool({ name: 'list-projects', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).toContain('project-viewer-a');
    expect(apiCalls.at(-1)).toEqual({ username: 'viewer-a', site: 'eas-site-id' });
    expect(exchanges.slice(exchangeStart).every((jwt) => jwt === token)).toBe(true);
  } finally {
    await client.close();
  }
  await vi.waitFor(() => expect(sessions.size).toBe(0));
});

it('enforces the current request credentials and rejects another user using an existing MCP session', async () => {
  const { client, transport } = await connect(await sign());
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await sign({ external_username: 'viewer-b' })}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'mcp-session-id': transport.sessionId!,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(403);
    const result = await client.callTool({ name: 'list-projects', arguments: {} });
    expect(JSON.stringify(result)).toContain('project-viewer-a');
  } finally {
    await client.close();
  }
  const second = await connect(await sign({ external_username: 'viewer-b' }));
  try {
    expect(
      JSON.stringify(await second.client.callTool({ name: 'list-projects', arguments: {} })),
    ).toContain('project-viewer-b');
  } finally {
    await second.client.close();
  }
  await vi.waitFor(() => expect(sessions.size).toBe(0));
});

it('uses a narrower replacement token on an existing MCP session without retaining the earlier grant', async () => {
  const { client, headers } = await connect(await sign());
  try {
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['list-projects']);
    expect((await client.callTool({ name: 'list-projects', arguments: {} })).isError).not.toBe(
      true,
    );
    headers.Authorization = `Bearer ${await sign({ scope: 'openid tableau:views:download tableau:mcp_site_settings:read' })}`;
    expect((await client.callTool({ name: 'list-projects', arguments: {} })).isError).toBe(true);
  } finally {
    await client.close();
  }
  await vi.waitFor(() => expect(sessions.size).toBe(0));
});

it('rejects malformed, wrong-audience and invalid-signature tokens before any tool call', async () => {
  for (const token of [
    'invalid',
    await sign({ aud: 'wrong-audience' }),
    (await sign()).replace(/\.[^.]+$/, (sig) => `.${sig[1] === 'a' ? 'b' : 'a'}${sig.slice(2)}`),
  ]) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(401);
  }
  expect(sessions.size).toBe(0);
});

it('cleans up authentication for invalid MCP sessions and keeps credentials out of logs', async () => {
  const token = await sign();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-session-id': 'missing-session',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
  });
  expect(response.status).toBe(400);
  await vi.waitFor(() => expect(sessions.size).toBe(0));
  expect(output).not.toContain(token);
  for (const assertion of exchanges) expect(output).not.toContain(assertion);
  for (const credential of credentialsSeen) expect(output).not.toContain(credential);
});
