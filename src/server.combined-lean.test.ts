import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { LOAD_WEB_TOOLS_TOOL_NAME, WebMcpServer } from './server.web.js';
import { stubDefaultEnvVars } from './testShared.js';
import { getMockRequestHandlerExtra } from './tools/web/toolContext.mock.js';
import { webToolGroups } from './tools/web/toolName.js';

vi.mock('./features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: vi.fn(() => false) })),
}));

type RegisterToolCall = [
  string,
  { title?: string; description?: string; inputSchema?: unknown; annotations?: unknown },
  (args: any, extra: any) => Promise<CallToolResult>,
];

function getWebServer(): WebMcpServer {
  const server = new WebMcpServer();
  server.mcpServer.registerTool = vi.fn();
  return server;
}

function registerToolCalls(server: WebMcpServer): RegisterToolCall[] {
  return vi.mocked(server.mcpServer.registerTool).mock.calls as unknown as RegisterToolCall[];
}

function registeredNames(server: WebMcpServer): string[] {
  return registerToolCalls(server).map(([name]) => name);
}

function parseLoaderResult(result: CallToolResult): unknown {
  const content = result.content[0];
  if (content.type !== 'text') {
    throw new Error(`Expected text content, got ${content.type}`);
  }
  return JSON.parse(content.text);
}

describe('combined-lean TOOL_PROFILE (lazy web tools)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('registers exactly one web tool — the loader — instead of the eager web surface', async () => {
    vi.stubEnv('TOOL_PROFILE', 'combined-lean');
    const server = getWebServer();
    await server.registerTools();

    expect(registeredNames(server)).toEqual([LOAD_WEB_TOOLS_TOOL_NAME]);
  });

  it('keeps the eager web surface (and no loader) when TOOL_PROFILE is unset', async () => {
    const server = getWebServer();
    await server.registerTools();

    const names = registeredNames(server);
    expect(names).toContain('list-datasources');
    expect(names).not.toContain(LOAD_WEB_TOOLS_TOOL_NAME);
  });

  // The 46k tools/list byte-cliff assertion was RETIRED 2026-07-21 (owner decision):
  // profile-based serving is the operative constraint now — the dynamic-authoring
  // profile the product loads sits far under any deferral limit, and full route
  // coverage of the External Client API outranks squeezing full-surface prose.

  it('load-web-tools registers the pulse group on demand and is idempotent', async () => {
    vi.stubEnv('TOOL_PROFILE', 'combined-lean');
    const server = getWebServer();
    await server.registerTools();

    const loaderCall = registerToolCalls(server).find(
      ([name]) => name === LOAD_WEB_TOOLS_TOOL_NAME,
    );
    expect(loaderCall).toBeDefined();
    const loaderCallback = loaderCall![2];

    const before = registerToolCalls(server).length;
    const first = await loaderCallback({ group: 'pulse' }, getMockRequestHandlerExtra());
    expect(parseLoaderResult(first)).toEqual({
      status: 'loaded',
      toolNames: [...webToolGroups.pulse],
    });

    const pulseRegistered = registeredNames(server).filter((name) =>
      (webToolGroups.pulse as readonly string[]).includes(name),
    );
    expect(pulseRegistered.sort()).toEqual([...webToolGroups.pulse].sort());
    expect(registerToolCalls(server).length).toBe(before + webToolGroups.pulse.length);

    const beforeSecond = registerToolCalls(server).length;
    const second = await loaderCallback({ group: 'pulse' }, getMockRequestHandlerExtra());
    expect(parseLoaderResult(second)).toEqual({
      status: 'already-loaded',
      toolNames: [...webToolGroups.pulse],
    });
    expect(registerToolCalls(server).length).toBe(beforeSecond);
  });

  it('concurrent loader calls for the same group do not double-register (serialized)', async () => {
    vi.stubEnv('TOOL_PROFILE', 'combined-lean');
    const server = getWebServer();
    await server.registerTools();

    const loaderCallback = registerToolCalls(server).find(
      ([name]) => name === LOAD_WEB_TOOLS_TOOL_NAME,
    )![2];

    const before = registerToolCalls(server).length;
    const [first, second] = await Promise.all([
      loaderCallback({ group: 'pulse' }, getMockRequestHandlerExtra()),
      loaderCallback({ group: 'pulse' }, getMockRequestHandlerExtra()),
    ]);

    const statuses = [parseLoaderResult(first), parseLoaderResult(second)].map(
      (r) => (r as { status: string }).status,
    );
    expect(statuses.sort()).toEqual(['already-loaded', 'loaded']);
    expect(registerToolCalls(server).length).toBe(before + webToolGroups.pulse.length);
  });

  it('falls back to eager registration on stateless HTTP (lazy tools would die with the request)', async () => {
    vi.stubEnv('TOOL_PROFILE', 'combined-lean');
    vi.stubEnv('TRANSPORT', 'http');
    vi.stubEnv('DISABLE_SESSION_MANAGEMENT', 'true');
    vi.stubEnv('DANGEROUSLY_DISABLE_OAUTH', 'true');
    const server = getWebServer();
    await server.registerTools();

    const names = registeredNames(server);
    expect(names).not.toContain(LOAD_WEB_TOOLS_TOOL_NAME);
    expect(names).toContain('list-datasources');
  });

  it('load-web-tools respects EXCLUDE_TOOLS scoping when hydrating a group', async () => {
    vi.stubEnv('TOOL_PROFILE', 'combined-lean');
    vi.stubEnv('EXCLUDE_TOOLS', 'list-pulse-metric-subscriptions');
    const server = getWebServer();
    await server.registerTools();

    const loaderCallback = registerToolCalls(server).find(
      ([name]) => name === LOAD_WEB_TOOLS_TOOL_NAME,
    )![2];
    await loaderCallback({ group: 'pulse' }, getMockRequestHandlerExtra());

    const names = registeredNames(server);
    expect(names).not.toContain('list-pulse-metric-subscriptions');
    expect(names).toContain('list-all-pulse-metric-definitions');
  });
});
