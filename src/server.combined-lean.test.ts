import { normalizeObjectSchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { DESKTOP_INSTRUCTIONS, DesktopMcpServer } from './server.desktop.js';
import { LOAD_WEB_TOOLS_TOOL_NAME, WebMcpServer } from './server.web.js';
import { stubDefaultEnvVars } from './testShared.js';
import { DesktopTool } from './tools/desktop/tool.js';
import { desktopToolFactories } from './tools/desktop/tools.js';
import { getMockRequestHandlerExtra } from './tools/web/toolContext.mock.js';
import { webToolGroups } from './tools/web/toolName.js';
import { Provider } from './utils/provider.js';

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

/** Same serialization as server.desktop.test.ts's budget test, for a registerTool call. */
function serializeRegisterToolCall([name, config]: RegisterToolCall): string {
  const obj = normalizeObjectSchema(config.inputSchema as any);
  const inputSchema = obj
    ? toJsonSchemaCompat(obj, { strictUnions: true, pipeStrategy: 'input' } as any)
    : { type: 'object', properties: {} };

  return JSON.stringify({
    name,
    title: config.title,
    description: config.description,
    inputSchema,
    annotations: config.annotations,
    execution: { taskSupport: 'forbidden' },
  });
}

async function serializeDesktopToolSurface(tool: DesktopTool<any>): Promise<string> {
  const paramsSchema = await Provider.from(tool.paramsSchema);
  const obj = normalizeObjectSchema(paramsSchema as any);
  const inputSchema = obj
    ? toJsonSchemaCompat(obj, { strictUnions: true, pipeStrategy: 'input' } as any)
    : { type: 'object', properties: {} };

  return JSON.stringify({
    name: tool.name,
    title: await Provider.from(tool.title),
    description: await Provider.from(tool.description),
    inputSchema,
    annotations: await Provider.from(tool.annotations),
    execution: { taskSupport: 'forbidden' },
  });
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

  it('combined-lean stays under the 46k tools/list auto-deferral cliff (desktop full + loader)', async () => {
    vi.stubEnv('TOOL_PROFILE', 'combined-lean');
    const webServer = getWebServer();
    await webServer.registerTools();

    const loaderCall = registerToolCalls(webServer).find(
      ([name]) => name === LOAD_WEB_TOOLS_TOOL_NAME,
    );
    expect(loaderCall).toBeDefined();
    const loaderEntry = serializeRegisterToolCall(loaderCall!);
    // The loader is the ONLY eager web cost of combined-lean; keep it a stub. Most of its
    // bytes are the group enum itself — do not add prose to its description.
    expect(loaderEntry.length).toBeLessThanOrEqual(650);

    // Desktop half registers its full surface. Unlike the desktop budget test's per-entry
    // sum, count the ACTUAL tools/list payload shape — {"tools":[...]} with comma
    // separators — so the assert can't pass while real clients see more bytes.
    const desktopServer = new DesktopMcpServer();
    const entries: string[] = [loaderEntry];
    for (const toolFactory of desktopToolFactories) {
      entries.push(await serializeDesktopToolSurface(toolFactory(desktopServer)));
    }
    const payloadBytes = `{"tools":[${entries.join(',')}]}`.length;
    const total = payloadBytes + DESKTOP_INSTRUCTIONS.length;

    // Same cliff as server.desktop.test.ts: past 46_000 serialized bytes, hosts defer the
    // whole surface behind ToolSearch. combined-lean exists precisely to keep the combined
    // build under it, so this must hold as tools evolve.
    expect(total).toBeLessThanOrEqual(46_000);
  });

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
