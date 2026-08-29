import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MockedFunction } from 'vitest';

import { ServiceUnavailableError } from './errors/mcpToolError.js';
import * as logger from './logging/logger.js';
import { serverName, WebMcpServer } from './server.web.js';
import { stubDefaultEnvVars, testProductVersion } from './testShared.js';
import { exportedForTesting } from './tools/web/datasources/listDatasources.js';
import { getQueryDatasourceTool } from './tools/web/queryDatasource/queryDatasource.js';
import { WebTool } from './tools/web/tool.js';
import { TableauWebToolCallback } from './tools/web/toolContext.js';
import { getMockRequestHandlerExtra } from './tools/web/toolContext.mock.js';
import { WebToolName, webToolNames } from './tools/web/toolName.js';
import { webToolFactories } from './tools/web/tools.js';
import invariant from './utils/invariant.js';
import { Provider } from './utils/provider.js';

const mocks = vi.hoisted(() => ({
  mockRegisterAppTool: vi.fn(),
  mockRegisterAppResource: vi.fn(),
  mockFeatureGate: {
    // Typed to accept the feature name so tests can enable a specific flag via mockImplementation.
    isFeatureEnabled: vi.fn((_featureName: string) => false),
  },
  mockReadFile: vi.fn(),
  mockGetCurrentUserSiteRole: vi.fn(),
  mockAssertAdmin: vi.fn(),
}));

vi.mock('@modelcontextprotocol/ext-apps/server', () => ({
  registerAppTool: mocks.mockRegisterAppTool,
  registerAppResource: mocks.mockRegisterAppResource,
  RESOURCE_MIME_TYPE: 'text/html',
}));

vi.mock('./features/init.js', () => ({
  getFeatureGate: vi.fn(() => mocks.mockFeatureGate),
}));

vi.mock('fs/promises', () => ({
  readFile: (...args: any[]) => mocks.mockReadFile(...args),
}));

vi.mock('./tools/web/adminGate.js', () => ({
  getCurrentUserSiteRole: mocks.mockGetCurrentUserSiteRole,
  assertAdmin: mocks.mockAssertAdmin,
}));

// Auto-mock the telemetry logger so the registration-time warning is captured as a spy call.
vi.mock('./logging/logger.js');

describe('server', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    mocks.mockRegisterAppTool.mockClear();
    mocks.mockRegisterAppResource.mockClear();
    mocks.mockFeatureGate.isFeatureEnabled.mockReturnValue(false);
    mocks.mockReadFile.mockClear();
    mocks.mockGetCurrentUserSiteRole.mockReset().mockResolvedValue('SiteAdministratorCreator');
    mocks.mockAssertAdmin.mockReset();
    (logger.log as MockedFunction<typeof logger.log>).mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Helper functions
  function getServer(): WebMcpServer {
    const server = new WebMcpServer();
    server.mcpServer.registerTool = vi.fn();
    return server;
  }

  function createMockAppTool(): WebTool<any> {
    return {
      name: 'mock-app-tool' as WebToolName,
      server: {} as any,
      title: 'Test App Tool',
      description: 'Test App Tool',
      paramsSchema: {},
      annotations: {
        title: 'Test App Tool',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      callback: vi.fn(),
      disabled: false,
      requiredApiScopes: [],
      minRequiredRole: undefined,
      logAndExecute: vi.fn(),
      notifyInvocation: vi.fn(),
      app: {
        name: 'test-app',
        resourceUri: 'tableau://app/test',
        htmlPath: '<html><body>Test App UI</body></html>',
      },
    };
  }

  it('should register tools', async () => {
    const server = getServer();
    await server.registerTools();

    const allTools = await Promise.all(
      webToolFactories.map((toolFactory) => toolFactory(server, testProductVersion)),
    );
    const disabledFlags = await Promise.all(allTools.map((tool) => Provider.from(tool.disabled)));
    const tools = allTools.filter((_, i) => !disabledFlags[i]);
    for (const tool of tools) {
      expect(server.mcpServer.registerTool).toHaveBeenCalledWith(
        tool.name,
        {
          title: await Provider.from(tool.title),
          description: await Provider.from(tool.description),
          inputSchema: await Provider.from(tool.paramsSchema),
          annotations: await Provider.from(tool.annotations),
        },
        expect.any(Function),
      );
    }
  });

  it('should use the web variant server name', () => {
    expect(new WebMcpServer().name).toBe(serverName);
  });

  // The server-level `instructions` string (surfaced by the SDK in the `initialize` result) is
  // passed to the McpServer constructor's second options object. McpServer is globally mocked
  // (see testSetup.ts), so assert on the constructor arguments the mock captured.
  function getConstructedInstructions(): string | undefined {
    const calls = vi.mocked(McpServer).mock.calls;
    const lastCall = calls[calls.length - 1];
    return (lastCall?.[1] as { instructions?: string } | undefined)?.instructions;
  }

  it('should include admin site-health guidance in instructions when ADMIN_TOOLS_ENABLED is "true"', () => {
    vi.mocked(McpServer).mockClear();
    vi.stubEnv('ADMIN_TOOLS_ENABLED', 'true');
    new WebMcpServer();
    const instructions = getConstructedInstructions();

    expect(instructions).toBeTruthy();
    // Admin capability menu + generic-intent tie-in.
    expect(instructions).toContain('site-administration capabilities');
    expect(instructions).toContain('general admin/site-health');
    expect(instructions).toContain('user-license reclamation');
    expect(instructions).toContain('query-admin-insights');
  });

  it('should omit admin guidance from instructions when ADMIN_TOOLS_ENABLED is unset', () => {
    vi.mocked(McpServer).mockClear();
    vi.stubEnv('ADMIN_TOOLS_ENABLED', undefined);
    new WebMcpServer();
    const instructions = getConstructedInstructions();

    // Base guidance is still present...
    expect(instructions).toBeTruthy();
    expect(instructions).toContain('Tableau MCP exposes tools');
    // ...but nothing about admin capabilities.
    expect(instructions).not.toContain('site-administration capabilities');
    expect(instructions).not.toContain('general admin/site-health');
    expect(instructions).not.toContain('query-admin-insights');
  });

  it('should not register disabled tools', async () => {
    const server = getServer();
    await server.registerTools();

    const allDisabledTools = await Promise.all(
      webToolFactories.map((toolFactory) => toolFactory(server, testProductVersion)),
    );
    const disabledToolFlags = await Promise.all(
      allDisabledTools.map((tool) => Provider.from(tool.disabled)),
    );
    const disabledTools = allDisabledTools.filter((_, i) => disabledToolFlags[i]);
    for (const tool of disabledTools) {
      expect(server.mcpServer.registerTool).not.toHaveBeenCalledWith(
        tool.name,
        expect.anything(),
        expect.anything(),
      );
    }
  });

  it('should not register flow tools by default (FLOW_TOOLS_ENABLED unset)', async () => {
    const server = getServer();
    await server.registerTools();

    const registeredToolNames = vi
      .mocked(server.mcpServer.registerTool)
      .mock.calls.map((call) => call[0 /* tool name */]);

    // Flow tools are gated off by default...
    expect(registeredToolNames).not.toContain('list-flows');
    expect(registeredToolNames).not.toContain('get-flow');
    expect(registeredToolNames).not.toContain('list-flow-runs');
    expect(registeredToolNames).not.toContain('list-flow-tasks');
    // ...while unrelated tools stay registered.
    expect(registeredToolNames).toContain('list-datasources');
  });

  it('should register flow tools when FLOW_TOOLS_ENABLED is "true"', async () => {
    vi.stubEnv('FLOW_TOOLS_ENABLED', 'true');
    const server = getServer();
    await server.registerTools();

    const registeredToolNames = vi
      .mocked(server.mcpServer.registerTool)
      .mock.calls.map((call) => call[0 /* tool name */]);

    // The single switch turns on every flow tool...
    expect(registeredToolNames).toContain('list-flows');
    expect(registeredToolNames).toContain('get-flow');
    expect(registeredToolNames).toContain('list-flow-runs');
    expect(registeredToolNames).toContain('list-flow-tasks');
    // ...alongside the unrelated tools.
    expect(registeredToolNames).toContain('list-datasources');
  });

  it('should not register insight tools by default (INSIGHTS_TOOLS_ENABLED unset)', async () => {
    const server = getServer();
    await server.registerTools();

    const registeredToolNames = vi
      .mocked(server.mcpServer.registerTool)
      .mock.calls.map((call) => call[0 /* tool name */]);

    // Insight tools are gated off by default so hosts (e.g. Slackbot) stay stable...
    expect(registeredToolNames).not.toContain('generate-insight-cards');
    // ...while unrelated tools stay registered.
    expect(registeredToolNames).toContain('list-datasources');
  });

  it('should register insight tools when INSIGHTS_TOOLS_ENABLED is "true"', async () => {
    vi.stubEnv('INSIGHTS_TOOLS_ENABLED', 'true');
    const server = getServer();
    await server.registerTools();

    const registeredToolNames = vi
      .mocked(server.mcpServer.registerTool)
      .mock.calls.map((call) => call[0 /* tool name */]);

    expect(registeredToolNames).toContain('generate-insight-cards');
    expect(registeredToolNames).toContain('list-datasources');
  });

  it('should register tools filtered by includeTools', async () => {
    vi.stubEnv('INCLUDE_TOOLS', 'query-datasource');
    const server = getServer();
    await server.registerTools();

    const tool = getQueryDatasourceTool(server, testProductVersion);
    expect(server.mcpServer.registerTool).toHaveBeenCalledWith(
      tool.name,
      {
        title: await Provider.from(tool.title),
        description: await Provider.from(tool.description),
        inputSchema: await Provider.from(tool.paramsSchema),
        annotations: await Provider.from(tool.annotations),
      },
      expect.any(Function),
    );
  });

  it('should register tools filtered by excludeTools', async () => {
    vi.stubEnv('EXCLUDE_TOOLS', 'query-datasource');
    const server = getServer();
    await server.registerTools();

    const tools = await Promise.all(
      webToolFactories.map((toolFactory) => toolFactory(server, testProductVersion)),
    );
    const excludeDisabledFlags = await Promise.all(
      tools.map((tool) => Provider.from(tool.disabled)),
    );
    for (const [i, tool] of tools.entries()) {
      if (tool.name === 'query-datasource' || excludeDisabledFlags[i]) {
        expect(server.mcpServer.registerTool).not.toHaveBeenCalledWith(
          tool.name,
          expect.anything(),
          expect.anything(),
        );
      } else {
        expect(server.mcpServer.registerTool).toHaveBeenCalledWith(
          tool.name,
          {
            title: await Provider.from(tool.title),
            description: await Provider.from(tool.description),
            inputSchema: await Provider.from(tool.paramsSchema),
            annotations: await Provider.from(tool.annotations),
          },
          expect.any(Function),
        );
      }
    }
  });

  it('should not throw and not register any tools when all are excluded', async () => {
    const sortedToolNames = [...webToolNames].sort((a, b) => a.localeCompare(b)).join(', ');
    vi.stubEnv('EXCLUDE_TOOLS', sortedToolNames);
    const server = getServer();

    await expect(server.registerTools()).resolves.toBeUndefined();
    expect(server.mcpServer.registerTool).not.toHaveBeenCalled();
  });

  it('should reject tool calls with service unavailable error when BREAK_GLASS_DISABLE_GLOBALLY is true', async () => {
    vi.stubEnv('BREAK_GLASS_DISABLE_GLOBALLY', 'true');

    const server = getServer();
    await server.registerTools();

    const listDatasourcesRegistration = vi
      .mocked(server.mcpServer.registerTool)
      .mock.calls.find((call) => call[0 /* tool name */] === 'list-datasources');

    invariant(listDatasourcesRegistration);
    const listDatasourcesCallback =
      listDatasourcesRegistration[2 /* callback */] as TableauWebToolCallback<
        Partial<typeof exportedForTesting.listDatasourcesParamsSchema>
      >;

    await expect(listDatasourcesCallback({}, getMockRequestHandlerExtra())).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ServiceUnavailableError &&
        error.type === 'service-unavailable' &&
        error.statusCode === 503 &&
        error.message ===
          'The Tableau MCP server is temporarily unavailable. Please try again later.',
    );
  });

  it('should register app tools when tool has app property', async () => {
    // Set custom CSP domains via environment
    vi.stubEnv('CSP_ALLOWED_DOMAINS', 'https://*.custom.com,https://other.com');

    mocks.mockFeatureGate.isFeatureEnabled.mockReturnValue(true);

    const server = getServer();
    const mockAppTool = createMockAppTool();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([mockAppTool]);

    await server.registerTools();

    expect(mocks.mockRegisterAppTool).toHaveBeenCalledWith(
      server.mcpServer,
      'mock-app-tool',
      {
        title: 'Test App Tool',
        description: 'Test App Tool',
        inputSchema: {},
        annotations: {
          title: 'Test App Tool',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        _meta: {
          ui: {
            resourceUri: 'tableau://app/test',
          },
        },
      },
      expect.any(Function),
    );

    // Assert registerAppResource was called with correct options (no _meta in options)
    expect(mocks.mockRegisterAppResource).toHaveBeenCalledWith(
      server.mcpServer,
      'mock-app-tool',
      'tableau://app/test',
      {
        mimeType: expect.any(String),
      },
      expect.any(Function),
    );

    // Invoke the read callback and assert _meta is on the returned content
    const registerAppResourceCall = mocks.mockRegisterAppResource.mock.calls[0];
    const readCallback = registerAppResourceCall[4]; // 5th arg (0-indexed)

    // Mock readFile to return test HTML content
    mocks.mockReadFile.mockResolvedValueOnce('<html><body>Test App UI</body></html>');

    const result = await readCallback();

    expect(result.contents[0]._meta).toEqual({
      ui: {
        csp: {
          connectDomains: expect.arrayContaining([
            'https://*.online.tableau.com',
            'https://*.tableau.com',
            'https://my-tableau-server.com',
            'https://*.custom.com',
            'https://other.com',
          ]),
          resourceDomains: expect.arrayContaining([
            'https://*.online.tableau.com',
            'https://*.tableau.com',
            'https://my-tableau-server.com',
            'https://*.custom.com',
            'https://other.com',
          ]),
          frameDomains: expect.arrayContaining([
            'https://*.online.tableau.com',
            'https://*.tableau.com',
            'https://my-tableau-server.com',
            'https://*.custom.com',
            'https://other.com',
          ]),
        },
      },
    });
  });

  function createMockAdminTool(): WebTool<any> {
    return {
      name: 'mock-admin-tool' as WebToolName,
      server: {} as any,
      title: 'Mock Admin Tool',
      description: 'Mock Admin Tool',
      paramsSchema: {},
      annotations: {
        title: 'Mock Admin Tool',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      callback: vi.fn(),
      disabled: false,
      minRequiredRole: 'SiteAdministratorExplorer',
      requiredApiScopes: [],
      logAndExecute: vi.fn(),
      notifyInvocation: vi.fn(),
    } as unknown as WebTool<any>;
  }

  // The registration-time role check is gated behind the `enforce-role-requirements` flag. With the
  // flag ON the tool's minRequiredRole is enforced; with it OFF the check is skipped entirely.
  const enforceRoleRequirements = (name: string): boolean => name === 'enforce-role-requirements';

  it('does not register a tool when the caller ranks below minRequiredRole', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(enforceRoleRequirements);
    mocks.mockGetCurrentUserSiteRole.mockResolvedValue('Viewer');

    const server = getServer();
    const mockAdminTool = createMockAdminTool();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([mockAdminTool]);

    await server.registerTools();

    expect(server.mcpServer.registerTool).not.toHaveBeenCalledWith(
      'mock-admin-tool',
      expect.anything(),
      expect.anything(),
    );
  });

  it('registers a tool when the caller ranks at or above minRequiredRole', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(enforceRoleRequirements);
    mocks.mockGetCurrentUserSiteRole.mockResolvedValue('SiteAdministratorCreator');

    const server = getServer();
    const mockAdminTool = createMockAdminTool();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([mockAdminTool]);

    await server.registerTools();

    expect(server.mcpServer.registerTool).toHaveBeenCalledWith(
      'mock-admin-tool',
      expect.anything(),
      expect.any(Function),
    );
  });

  it('does not register a tool when the caller has no site role (fetch failed)', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(enforceRoleRequirements);
    mocks.mockGetCurrentUserSiteRole.mockResolvedValue(undefined);

    const server = getServer();
    const mockAdminTool = createMockAdminTool();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([mockAdminTool]);

    await server.registerTools();

    expect(server.mcpServer.registerTool).not.toHaveBeenCalledWith(
      'mock-admin-tool',
      expect.anything(),
      expect.anything(),
    );
  });

  it('registers a below-rank tool when enforce-role-requirements is off and never fetches the site role', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockReturnValue(false);
    mocks.mockGetCurrentUserSiteRole.mockResolvedValue('Viewer');

    const server = getServer();
    const mockAdminTool = createMockAdminTool();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([mockAdminTool]);

    await server.registerTools();

    expect(server.mcpServer.registerTool).toHaveBeenCalledWith(
      'mock-admin-tool',
      expect.anything(),
      expect.any(Function),
    );
    // The gate short-circuits before the role fetch, so no /users call is issued.
    expect(mocks.mockGetCurrentUserSiteRole).not.toHaveBeenCalled();
  });

  // The SDK emits server-level instructions from `mcpServer.server._instructions` at initialize
  // time; registration mutates that field, so read it directly to assert the handshake guidance.
  function getInstructions(server: WebMcpServer): string {
    return (server.mcpServer.server as unknown as { _instructions?: string })._instructions ?? '';
  }

  it('warns in the connect instructions when a role-gated tool is omitted because the role fetch failed', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(enforceRoleRequirements);
    // undefined uniquely signals a failed fetch (a successful low-role fetch returns the role string).
    mocks.mockGetCurrentUserSiteRole.mockResolvedValue(undefined);

    const server = getServer();
    const mockAdminTool = createMockAdminTool();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([mockAdminTool]);

    await server.registerTools();

    expect(server.mcpServer.registerTool).not.toHaveBeenCalledWith(
      'mock-admin-tool',
      expect.anything(),
      expect.anything(),
    );
    expect(getInstructions(server)).toContain('site role could not be determined');
  });

  it('does not warn when the role was fetched but ranks too low (legitimate omission)', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(enforceRoleRequirements);
    mocks.mockGetCurrentUserSiteRole.mockResolvedValue('Viewer');

    const server = getServer();
    const mockAdminTool = createMockAdminTool();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([mockAdminTool]);

    await server.registerTools();

    expect(getInstructions(server)).not.toContain('site role could not be determined');
  });

  it('does not warn when enforce-role-requirements is off (no role check, nothing omitted)', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockReturnValue(false);
    mocks.mockGetCurrentUserSiteRole.mockResolvedValue(undefined);

    const server = getServer();
    const mockAdminTool = createMockAdminTool();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([mockAdminTool]);

    await server.registerTools();

    expect(getInstructions(server)).not.toContain('site role could not be determined');
  });

  // Telemetry-side (server log) counterpart to the client-facing instructions warning above.
  function getWarningLogs(): Array<Parameters<typeof logger.log>[0]> {
    const log = logger.log as MockedFunction<typeof logger.log>;
    return log.mock.calls.map((c) => c[0]).filter((e) => e.level === 'warning');
  }

  it('logs a telemetry warning when a role-gated tool is omitted because the role fetch failed', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(enforceRoleRequirements);
    mocks.mockGetCurrentUserSiteRole.mockResolvedValue(undefined);

    const server = getServer();
    const mockAdminTool = createMockAdminTool();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([mockAdminTool]);

    await server.registerTools();

    const warnings = getWarningLogs();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('site role');
    // Names the omitted tool so operators can see what was hidden.
    expect(warnings[0].message).toContain('mock-admin-tool');
  });

  it('does not log a telemetry warning when the role was fetched but ranks too low', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(enforceRoleRequirements);
    mocks.mockGetCurrentUserSiteRole.mockResolvedValue('Viewer');

    const server = getServer();
    const mockAdminTool = createMockAdminTool();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([mockAdminTool]);

    await server.registerTools();

    expect(getWarningLogs()).toHaveLength(0);
  });

  it('should register as standard tool when mcp-apps feature flag is disabled', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockReturnValue(false);

    const server = getServer();
    const mockAppTool = createMockAppTool();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([mockAppTool]);

    await server.registerTools();

    // Should register as standard tool, not app tool
    expect(server.mcpServer.registerTool).toHaveBeenCalledWith(
      'mock-app-tool',
      {
        title: 'Test App Tool',
        description: 'Test App Tool',
        inputSchema: {},
        annotations: {
          title: 'Test App Tool',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      expect.any(Function),
    );

    // Should NOT register as app tool
    expect(mocks.mockRegisterAppTool).not.toHaveBeenCalled();
    expect(mocks.mockRegisterAppResource).not.toHaveBeenCalled();
  });
});
