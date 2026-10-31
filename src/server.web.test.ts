import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MockedFunction } from 'vitest';

import features from '../features.json';
import { ServiceUnavailableError } from './errors/mcpToolError.js';
import * as logger from './logging/logger.js';
import { SiteRole } from './sdks/tableau/types/user.js';
import { buildWebInstructions, serverName, WebMcpServer } from './server.web.js';
import { ClientCapabilitiesWithUiExtension } from './server/mcpUiCapability.js';
import { TableauAuthInfo } from './server/oauth/schemas.js';
import { getConditionApiScopesForTool } from './server/oauth/scopes.js';
import { stubDefaultEnvVars, testProductVersion } from './testShared.js';
import { exportedForTesting } from './tools/web/datasources/listDatasources.js';
import { getUpdateFlowConnectionTool } from './tools/web/flows/updateFlowConnection.js';
import { getInspectKnowledgeContextTool } from './tools/web/knowledge/inspectKnowledgeContext.js';
import { getManageKnowledgeContextTool } from './tools/web/knowledge/manageKnowledgeContext.js';
import { getQueryKnowledgeContextTool } from './tools/web/knowledge/queryKnowledgeContext.js';
import { getQueryDatasourceTool } from './tools/web/queryDatasource/queryDatasource.js';
import { REGISTRATION_CONDITION_API_SCOPES } from './tools/web/registrationConditions.js';
import { WebTool } from './tools/web/tool.js';
import { TableauWebToolCallback } from './tools/web/toolContext.js';
import { getMockRequestHandlerExtra } from './tools/web/toolContext.mock.js';
import { webToolGroups, WebToolName, webToolNames } from './tools/web/toolName.js';
import { webToolFactories } from './tools/web/tools.js';
import invariant from './utils/invariant.js';
import { Provider } from './utils/provider.js';

const mocks = vi.hoisted(() => ({
  mockRegisterAppTool: vi.fn(),
  mockRegisterAppResource: vi.fn(),
  mockFeatureGate: {
    isFeatureEnabled: vi.fn((_featureName: string) => false),
  },
  mockReadFile: vi.fn(),
  mockRunningAsSea: vi.fn(() => false),
  mockReadSeaAssetText: vi.fn(),
  mockGetCurrentUserSiteRole: vi.fn(),
  mockAssertAdmin: vi.fn(),
  mockCheckRegistrationConditions: vi.fn(),
}));

const UI_EXTENSION_ID = 'io.modelcontextprotocol/ui';

vi.mock('@modelcontextprotocol/ext-apps/server', () => ({
  registerAppTool: mocks.mockRegisterAppTool,
  registerAppResource: mocks.mockRegisterAppResource,
  RESOURCE_MIME_TYPE: 'text/html',
  // Mirror ext-apps' real getUiCapability: return the SEP-1724 UI extension object, if present.
  getUiCapability: (capabilities: { extensions?: Record<string, unknown> } | undefined) =>
    capabilities?.extensions?.[UI_EXTENSION_ID],
}));

// Client capabilities advertising MCP-Apps rendering support (uses the mocked RESOURCE_MIME_TYPE).
const uiCapableClientCapabilities: ClientCapabilitiesWithUiExtension = {
  extensions: { [UI_EXTENSION_ID]: { mimeTypes: ['text/html'] } },
};

vi.mock('./features/init.js', () => ({
  getFeatureGate: vi.fn(() => mocks.mockFeatureGate),
}));

vi.mock('fs/promises', () => ({
  readFile: (...args: any[]) => mocks.mockReadFile(...args),
}));

vi.mock('./utils/sea.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./utils/sea.js')>()),
  runningAsSea: mocks.mockRunningAsSea,
  readSeaAssetText: mocks.mockReadSeaAssetText,
}));

vi.mock('./tools/web/adminGate.js', () => ({
  getCurrentUserSiteRole: mocks.mockGetCurrentUserSiteRole,
  assertAdmin: mocks.mockAssertAdmin,
}));

// Only the capability probe is stubbed — the real `getUnmetConditionInstructions` is kept so the
// instructions assertions below verify the copy users actually receive.
vi.mock('./tools/web/registrationConditions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tools/web/registrationConditions.js')>();
  return {
    ...actual,
    checkRegistrationConditions: mocks.mockCheckRegistrationConditions,
  };
});

// Auto-mock the telemetry logger so the registration-time warning is captured as a spy call.
vi.mock('./logging/logger.js');

describe('server', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    vi.stubEnv('ENABLE_MCP_SITE_SETTINGS', 'false');
    mocks.mockRegisterAppTool.mockClear();
    mocks.mockRegisterAppResource.mockClear();
    mocks.mockFeatureGate.isFeatureEnabled.mockReturnValue(false);
    mocks.mockReadFile.mockClear();
    mocks.mockRunningAsSea.mockReset().mockReturnValue(false);
    mocks.mockReadSeaAssetText.mockReset();
    mocks.mockGetCurrentUserSiteRole.mockReset().mockResolvedValue('SiteAdministratorCreator');
    mocks.mockAssertAdmin.mockReset();
    mocks.mockCheckRegistrationConditions
      .mockReset()
      .mockResolvedValue({ registrationConditionsMet: true });
    (logger.log as MockedFunction<typeof logger.log>).mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Helper functions
  function getServer(opts?: {
    capabilities?: ClientCapabilitiesWithUiExtension;
    clientId?: string;
    shared?: boolean;
  }): WebMcpServer {
    const mcpServer = opts?.shared
      ? new McpServer(
          { name: 'combined-test', version: '0.0.0' },
          { capabilities: { tools: {} }, instructions: buildWebInstructions() },
        )
      : undefined;
    if (mcpServer) {
      (mcpServer.server as unknown as { _instructions?: string })._instructions =
        buildWebInstructions();
    }
    const server = new WebMcpServer({
      mcpServer,
      capabilities: opts?.capabilities,
      clientId: opts?.clientId,
    });
    server.mcpServer.registerTool = vi.fn();
    server.mcpServer.registerPrompt = vi.fn();
    return server;
  }

  function createMockAppTool(opts?: {
    hideWhenUnsupported?: boolean;
    htmlPath?: string;
    name?: WebToolName;
  }): WebTool<any> {
    return {
      name: opts?.name ?? ('mock-app-tool' as WebToolName),
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
      callback: vi.fn().mockResolvedValue({ content: [] }),
      disabled: false,
      requiredApiScopes: [],
      minRequiredRole: SiteRole.VIEWER,
      registrationConditions: [],
      logAndExecute: vi.fn(),
      notifyInvocation: vi.fn(),
      app: {
        name: 'test-app',
        resourceUri: 'tableau://app/test',
        htmlPath: opts?.htmlPath ?? 'web/apps/dist/mcp-app.html',
        ...(opts?.hideWhenUnsupported ? { hideWhenUnsupported: true } : {}),
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

  // The scope layer advertises each tool's registration-condition probe scopes from a
  // `conditionApiScopes` field in scopes.ts's toolScopeMap. Those scopes must match what the tool
  // instance's declared `registrationConditions` map to via REGISTRATION_CONDITION_API_SCOPES. If the
  // two drift, a conditional tool's probe scope silently stops being advertised. This asserts they
  // stay identical for every tool.
  it('should keep toolScopeMap conditionApiScopes in sync with each tool instance registrationConditions', async () => {
    const server = getServer();
    const allTools = await Promise.all(
      webToolFactories.map((toolFactory) => toolFactory(server, testProductVersion)),
    );

    for (const tool of allTools) {
      const expectedScopes = [
        ...new Set(
          tool.registrationConditions.flatMap((condition) => [
            ...REGISTRATION_CONDITION_API_SCOPES[condition],
          ]),
        ),
      ].sort();
      const mapScopes = [...getConditionApiScopesForTool(tool.name)].sort();
      expect(mapScopes, `condition scope mismatch for ${tool.name}`).toEqual(expectedScopes);
    }
  });

  it('should use the web variant server name', () => {
    expect(new WebMcpServer().name).toBe(serverName);
  });

  it('advertises the skills extension capability when skills-over-mcp is enabled', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(
      (name: string) => name === 'skills-over-mcp',
    );
    const server = getServer();
    await server.registerTools();

    expect(server.mcpServer.server.registerCapabilities).toHaveBeenCalledWith({
      extensions: { 'io.modelcontextprotocol/skills': { directoryRead: false } },
    });
  });

  it('does not advertise the skills extension capability when skills-over-mcp is disabled', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(() => false);
    const server = getServer();
    await server.registerTools();

    expect(server.mcpServer.server.registerCapabilities).not.toHaveBeenCalled();
  });

  const adminPromptNamesInInstructions = [
    'stale-content-cleanup-inform',
    'stale-content-cleanup-apply',
    'job-optimization-inform',
    'extract-optimization-apply',
    'user-license-reclamation-inform',
    'user-license-reclamation-apply',
  ];

  // McpServer is globally mocked (see testSetup.ts) and does not copy the constructor's
  // `instructions` into `server._instructions` like the real SDK, so seed it to mirror the handshake.
  async function getRegisteredInstructions(): Promise<string> {
    vi.mocked(McpServer).mockClear();
    const server = getServer();
    const constructorOptions = vi.mocked(McpServer).mock.calls[0]?.[1] as
      | { instructions?: string }
      | undefined;
    const sdkServer = server.mcpServer.server as unknown as { _instructions?: string };
    sdkServer._instructions = constructorOptions?.instructions;
    await server.registerTools();
    return sdkServer._instructions ?? '';
  }

  // Admin tools are enabled when EITHER ADMIN_TOOLS_ENABLED is set OR the admin-tools flag is on, so
  // each of these scenarios (both on, env-only, flag-only) surfaces the full admin guidance block.
  it.each([
    {
      scenario: 'ADMIN_TOOLS_ENABLED is "true" and the admin-tools flag is ON',
      env: 'true',
      flag: true,
    },
    {
      scenario: 'ADMIN_TOOLS_ENABLED is "true" but the admin-tools flag is OFF',
      env: 'true',
      flag: false,
    },
    {
      scenario: 'the admin-tools flag is ON but ADMIN_TOOLS_ENABLED is unset',
      env: undefined,
      flag: true,
    },
  ])(
    'should include admin site-health guidance in instructions when $scenario',
    async ({ env, flag }) => {
      vi.stubEnv('ADMIN_TOOLS_ENABLED', env);
      mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(
        (featureName: string) => flag && featureName === 'admin-tools',
      );
      const instructions = await getRegisteredInstructions();

      // Admin capability menu + generic-intent tie-in.
      expect(instructions).toContain('site-administration capabilities');
      expect(instructions).toContain('general admin/site-health');
      expect(instructions).toContain('query-admin-insights');
      // Every packaged admin prompt must be named by its exact invokable identifier so a fresh
      // session can discover and correctly invoke it without any external doc-feeding (W-23757369).
      // These names are kept in lockstep with the registered prompts in src/prompts/index.ts.
      for (const promptName of adminPromptNamesInInstructions) {
        expect(instructions).toContain(promptName);
      }
      // The model cannot call prompts/get (prompts are user-invoked slash commands), so the
      // instructions point it at the model-readable workflow resources instead (W-23757369).
      expect(instructions).not.toContain('prompts/get');
      expect(instructions).toContain('tableau-mcp://admin-workflows/<prompt-name>');
      expect(instructions).toContain('slash-command prompt');
      expect(instructions).toContain('If you cannot read MCP resources');
      // The inform (read-only) vs apply (destructive) distinction is stated explicitly.
      expect(instructions).toContain('read-only report');
      expect(instructions).toContain('dry-run by default');
      // Output-formatting nudge so chat/Slack surfaces render admin/list results as tables.
      // Assert on a distinctive slice of the actual clause, not the bare words "Markdown tables",
      // so a future edit that drops the rendering guidance can't silently pass.
      expect(instructions).toContain('present them as Markdown tables');
      expect(instructions).toContain('to a chat or Slack surface');
      // Admin-invocation nudge: the model must not gate admin-tool use on the user restating admin
      // status — the per-call assertAdmin gate authorizes each call and cleanly rejects non-admins.
      expect(instructions).toContain('Do not require the user to state or re-confirm admin status');

      // The admin block is appended after the base guidance, never spliced into the base sentence.
      expect(instructions.startsWith('Tableau MCP exposes tools')).toBe(true);
      const adminStart = instructions.indexOf('site-administration capabilities');
      const clauseStart = instructions.indexOf('present them as Markdown tables');
      expect(adminStart).toBeGreaterThan(-1);
      expect(clauseStart).toBeGreaterThan(adminStart);
    },
  );

  it('should omit admin guidance from instructions when both ADMIN_TOOLS_ENABLED and the admin-tools flag are off', async () => {
    vi.stubEnv('ADMIN_TOOLS_ENABLED', undefined);
    mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(() => false);
    const instructions = await getRegisteredInstructions();

    // Base guidance is still present...
    expect(instructions).toContain('Tableau MCP exposes tools');
    // ...but nothing from the admin-only block.
    expect(instructions).not.toContain('site-administration capabilities');
    expect(instructions).not.toContain('general admin/site-health');
    expect(instructions).not.toContain('query-admin-insights');
    for (const promptName of adminPromptNamesInInstructions) {
      expect(instructions).not.toContain(promptName);
    }
    expect(instructions).not.toContain('Markdown tables');
    expect(instructions).not.toContain('tableau-mcp://admin-workflows/');
    expect(instructions).not.toContain(
      'Do not require the user to state or re-confirm admin status',
    );
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

  describe('publishing tool discovery', () => {
    const publishingNames = [
      'request-workbook-upload',
      'request-datasource-upload',
      'publish-workbook',
      'publish-datasource',
    ];
    const caller = {
      username: 'publisher@example.com',
      userId: 'test-user-id',
      server: 'https://tableau.example.com',
      siteId: 'test-site-id',
      siteName: 'test-site',
    };
    const authModes: Array<{ label: string; auth: TableauAuthInfo | undefined }> = [
      { label: 'server credentials', auth: undefined },
      { label: 'embedded OAuth', auth: { type: 'X-Tableau-Auth', ...caller } },
      { label: 'Tableau OAuth', auth: { type: 'Bearer', ...caller, raw: 'test-token' } },
      { label: 'Passthrough', auth: { type: 'Passthrough', ...caller, raw: 'test-token' } },
    ];

    it.each(
      authModes.flatMap((mode) => [
        { ...mode, s3: false },
        { ...mode, s3: true },
      ]),
    )(
      'registers datasource and workbook publishing tools alike for $label with S3=$s3',
      async ({ auth, s3 }) => {
        vi.stubEnv('MCP_S3_BUCKET', s3 ? 'publish-uploads' : '');
        vi.stubEnv('INCLUDE_TOOLS', publishingNames.join(','));
        mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(
          (featureName: string) => featureName === 'datasource-authoring',
        );
        const server = getServer();
        await server.registerTools(auth);
        const registered = vi
          .mocked(server.mcpServer.registerTool)
          .mock.calls.map((call) => call[0]);
        expect(registered.sort()).toEqual([...publishingNames].sort());
      },
    );
  });

  const readFlowToolNames = [
    'list-flows',
    'get-flow',
    'list-flow-runs',
    'list-flow-tasks',
    'describe-flow',
    'get-flow-task',
  ];
  const writeFlowToolNames = ['run-flow', 'run-flow-task', 'cancel-flow-run'];

  const flowFlag = (readFlag: boolean, writeFlag: boolean) => (featureName: string) =>
    (featureName === 'flow-read-tools' && readFlag) ||
    (featureName === 'flow-write-tools' && writeFlag);

  it('registers all flow tools with shipped feature defaults and unset environment controls', async () => {
    vi.stubEnv('FLOW_READ_TOOLS_ENABLED', undefined);
    vi.stubEnv('FLOW_WRITE_TOOLS_ENABLED', undefined);
    mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(
      (featureName: string) => features[featureName as keyof typeof features] ?? false,
    );
    const server = getServer();
    await server.registerTools();

    const registeredToolNames = vi
      .mocked(server.mcpServer.registerTool)
      .mock.calls.map((call) => call[0 /* tool name */]);

    for (const toolName of [...readFlowToolNames, ...writeFlowToolNames]) {
      expect(registeredToolNames).toContain(toolName);
    }
    expect(registeredToolNames).toContain('list-datasources');
  });

  it.each(
    [false, true].flatMap((readFlag) =>
      [false, true].map((writeFlag) => ({ readFlag, writeFlag })),
    ),
  )(
    'uses hosted feature flags with unset environment overrides: read FF=$readFlag, write FF=$writeFlag',
    async ({ readFlag, writeFlag }) => {
      vi.stubEnv('FLOW_READ_TOOLS_ENABLED', undefined);
      vi.stubEnv('FLOW_WRITE_TOOLS_ENABLED', undefined);
      mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(flowFlag(readFlag, writeFlag));
      const server = getServer();
      await server.registerTools();
      const registeredToolNames: string[] = vi
        .mocked(server.mcpServer.registerTool)
        .mock.calls.map((call) => call[0]);

      for (const toolName of readFlowToolNames) {
        expect(registeredToolNames.includes(toolName)).toBe(readFlag);
      }
      for (const toolName of writeFlowToolNames) {
        expect(registeredToolNames.includes(toolName)).toBe(writeFlag);
      }
    },
  );

  it.each([
    { exclude: 'flow', envEnabled: false, readsEnabled: false },
    { exclude: 'run-flow,run-flow-task,cancel-flow-run', envEnabled: false, readsEnabled: true },
    { exclude: 'flow', envEnabled: true, readsEnabled: false },
    { exclude: 'run-flow,run-flow-task,cancel-flow-run', envEnabled: true, readsEnabled: true },
  ])(
    'honors self-hosted exclusions ($exclude) with environment overrides=$envEnabled and shipped flags',
    async ({ exclude, envEnabled, readsEnabled }) => {
      vi.stubEnv('EXCLUDE_TOOLS', exclude);
      vi.stubEnv('FLOW_READ_TOOLS_ENABLED', envEnabled ? 'true' : undefined);
      vi.stubEnv('FLOW_WRITE_TOOLS_ENABLED', envEnabled ? 'true' : undefined);
      mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(
        (featureName: string) => features[featureName as keyof typeof features] ?? false,
      );
      const server = getServer();
      await server.registerTools();
      const registeredToolNames: string[] = vi
        .mocked(server.mcpServer.registerTool)
        .mock.calls.map((call) => call[0]);

      for (const toolName of readFlowToolNames) {
        expect(registeredToolNames.includes(toolName)).toBe(readsEnabled);
      }
      for (const toolName of writeFlowToolNames) {
        expect(registeredToolNames).not.toContain(toolName);
      }
      expect(registeredToolNames).toContain('list-datasources');
    },
  );

  it.each(
    [undefined, false, true].flatMap((readEnv) =>
      [false, true].flatMap((readFlag) =>
        [undefined, false, true].flatMap((writeEnv) =>
          [false, true].map((writeFlag) => ({ readEnv, readFlag, writeEnv, writeFlag })),
        ),
      ),
    ),
  )(
    'registers flow tools for read env=$readEnv, read FF=$readFlag, write env=$writeEnv, write FF=$writeFlag',
    async ({ readEnv, readFlag, writeEnv, writeFlag }) => {
      vi.stubEnv('FLOW_READ_TOOLS_ENABLED', readEnv?.toString());
      vi.stubEnv('FLOW_WRITE_TOOLS_ENABLED', writeEnv?.toString());
      mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(flowFlag(readFlag, writeFlag));
      const server = getServer();
      await server.registerTools();
      const registeredToolNames: string[] = vi
        .mocked(server.mcpServer.registerTool)
        .mock.calls.map((call) => call[0]);

      for (const toolName of readFlowToolNames) {
        expect(registeredToolNames.includes(toolName)).toBe(readEnv ?? readFlag);
      }
      for (const toolName of writeFlowToolNames) {
        expect(registeredToolNames.includes(toolName)).toBe(writeEnv ?? writeFlag);
      }
    },
  );

  describe('admin tools', () => {
    const adminToolNames = [
      'list-extract-refresh-tasks',
      'update-cloud-extract-refresh-task',
      'list-jobs',
      'list-users',
      'update-user',
      'query-admin-insights',
      'delete-content',
    ];
    const adminPromptNames = [
      'stale-content-cleanup-inform',
      'stale-content-cleanup-apply',
      'job-optimization-inform',
      'extract-optimization-apply',
      'user-license-reclamation-inform',
      'user-license-reclamation-apply',
    ];

    const adminWorkflowResourceUris = adminPromptNames.map(
      (name) => `tableau-mcp://admin-workflows/${name}`,
    );

    async function getRegisteredNames(): Promise<{
      tools: string[];
      prompts: string[];
      resourceUris: string[];
    }> {
      const server = getServer();
      await server.registerTools();
      return {
        tools: vi.mocked(server.mcpServer.registerTool).mock.calls.map((call) => call[0]),
        prompts: vi.mocked(server.mcpServer.registerPrompt).mock.calls.map((call) => call[0]),
        resourceUris: vi
          .mocked(server.mcpServer.registerResource)
          .mock.calls.map((call) => String(call[1])),
      };
    }

    // Admin tools/prompts register when EITHER ADMIN_TOOLS_ENABLED is set OR the admin-tools flag is
    // on — every enabling scenario registers the same admin surface.
    it.each([
      {
        scenario: 'ADMIN_TOOLS_ENABLED is "true" and the admin-tools flag is ON',
        env: 'true',
        flag: true,
      },
      {
        scenario: 'ADMIN_TOOLS_ENABLED is "true" but the admin-tools flag is OFF',
        env: 'true',
        flag: false,
      },
      {
        scenario: 'the admin-tools flag is ON but ADMIN_TOOLS_ENABLED is unset',
        env: undefined,
        flag: true,
      },
    ])('should register admin tools and prompts when $scenario', async ({ env, flag }) => {
      vi.stubEnv('ADMIN_TOOLS_ENABLED', env);
      mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(
        (featureName: string) => flag && featureName === 'admin-tools',
      );
      const { tools, prompts } = await getRegisteredNames();

      expect(tools).toEqual(expect.arrayContaining(adminToolNames));
      expect(prompts).toEqual(expect.arrayContaining(adminPromptNames));
    });

    it('should register a workflow resource per admin prompt without adding any tool', async () => {
      const { tools: toolsWithoutAdmin } = await getRegisteredNames();
      vi.stubEnv('ADMIN_TOOLS_ENABLED', 'true');
      mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(
        (featureName: string) => featureName === 'admin-tools',
      );
      const { tools, prompts, resourceUris } = await getRegisteredNames();

      expect(resourceUris).toEqual(adminWorkflowResourceUris);
      expect(resourceUris).toHaveLength(prompts.length);
      // The only tools added by enabling admin are the pre-existing admin tools — no workflow tool.
      expect(tools.filter((name) => !toolsWithoutAdmin.includes(name)).sort()).toEqual(
        [...adminToolNames].sort(),
      );
      expect(tools.every((name) => webToolNames.includes(name as WebToolName))).toBe(true);
    });

    it('should not register workflow resources when admin tools are disabled', async () => {
      // Admin tools are disabled only when BOTH the env var and the flag are off.
      vi.stubEnv('ADMIN_TOOLS_ENABLED', undefined);
      const { resourceUris } = await getRegisteredNames();
      expect(resourceUris).toEqual([]);
    });

    it('should not register admin tools or prompts when ADMIN_TOOLS_ENABLED and the admin-tools flag are both off', async () => {
      vi.stubEnv('ADMIN_TOOLS_ENABLED', undefined);
      const { tools, prompts } = await getRegisteredNames();

      for (const name of adminToolNames) {
        expect(tools).not.toContain(name);
      }
      expect(prompts).toEqual([]);
      expect(tools).toContain('list-datasources');
    });
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

    // Flag on + a non-Claude clientId → app tool registers. Client capability is no longer
    // consulted, so no UI capability needs to be advertised for the app tool to register.
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

    expect(mocks.mockReadFile).toHaveBeenCalledWith(
      expect.stringMatching(/web[\\/]apps[\\/]dist[\\/]mcp-app\.html$/),
      'utf-8',
    );
    expect(mocks.mockReadSeaAssetText).not.toHaveBeenCalled();
    expect(result.contents[0].text).toBe('<html><body>Test App UI</body></html>');

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

  it('reads app resources from the embedded asset when running as a SEA', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockReturnValue(true);
    mocks.mockRunningAsSea.mockReturnValue(true);
    mocks.mockReadSeaAssetText.mockReturnValue('<html>embedded app</html>');

    const server = getServer();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([createMockAppTool()]);
    await server.registerTools();

    const readCallback = mocks.mockRegisterAppResource.mock.calls[0]?.[4];
    invariant(readCallback);
    const result = await readCallback();

    expect(mocks.mockReadSeaAssetText).toHaveBeenCalledWith('web/apps/dist/mcp-app.html');
    expect(mocks.mockReadFile).not.toHaveBeenCalled();
    expect(result.contents[0].text).toBe('<html>embedded app</html>');
  });

  it('fails closed when a SEA app resource is missing instead of falling back to disk', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockReturnValue(true);
    mocks.mockRunningAsSea.mockReturnValue(true);
    mocks.mockReadSeaAssetText.mockReturnValue(null);

    const server = getServer();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([createMockAppTool()]);
    await server.registerTools();

    const readCallback = mocks.mockRegisterAppResource.mock.calls[0]?.[4];
    invariant(readCallback);
    await expect(readCallback()).rejects.toThrow(
      "SEA app resource 'web/apps/dist/mcp-app.html' is missing or unreadable",
    );
    expect(mocks.mockReadFile).not.toHaveBeenCalled();
  });

  it.each([
    {
      clientId: 'https://cursor.com/some/cimd',
      expectedRenderable: true,
      registration: 'app',
    },
    {
      clientId: 'https://claude.ai/some/cimd',
      expectedRenderable: false,
      registration: 'plain',
    },
  ])(
    'passes mcpAppToolsRenderable=$expectedRenderable through a lazily registered $registration tool',
    async ({ clientId, expectedRenderable, registration }) => {
      vi.stubEnv('TOOL_PROFILE', 'combined-lean');
      mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(
        (featureName: string) => featureName === 'mcp-apps',
      );

      const server = getServer({ clientId, shared: true });
      const mockAppTool = createMockAppTool({ name: 'delete-content' });
      vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([mockAppTool]);

      await server.registerTools();
      await server.loadWebTools('content');

      const registeredCallback =
        registration === 'app'
          ? mocks.mockRegisterAppTool.mock.calls[0]?.[3]
          : vi
              .mocked(server.mcpServer.registerTool)
              .mock.calls.find((call) => call[0] === 'delete-content')?.[2];
      invariant(registeredCallback);
      await registeredCallback({}, getMockRequestHandlerExtra());

      expect(mockAppTool.callback).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ mcpAppToolsRenderable: expectedRenderable }),
      );
    },
  );

  describe('mcp-apps flag read', () => {
    const mcpAppsReads = (): number =>
      mocks.mockFeatureGate.isFeatureEnabled.mock.calls.filter(
        ([featureName]) => featureName === 'mcp-apps',
      ).length;

    it('happens once per eager registration pass regardless of tool count', async () => {
      const server = getServer();
      mocks.mockFeatureGate.isFeatureEnabled.mockClear();
      vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([
        createMockAppTool({ name: 'delete-content' }),
        createMockAppTool({ name: 'get-view-data' }),
        createMockAppTool({ name: 'query-datasource' }),
      ]);
      await server.registerTools();
      expect(mcpAppsReads()).toBe(1);
    });

    it('happens once per lazy load pass regardless of tool count', async () => {
      vi.stubEnv('TOOL_PROFILE', 'combined-lean');
      const server = getServer({ shared: true });
      await server.registerTools();
      mocks.mockFeatureGate.isFeatureEnabled.mockClear();
      vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([
        createMockAppTool({ name: 'delete-content' }),
        createMockAppTool({ name: 'confirm-delete-content' }),
      ]);
      const result = await server.loadWebTools('content');
      expect(result.toolNames).toEqual(['delete-content', 'confirm-delete-content']);
      expect(mcpAppsReads()).toBe(1);
    });
  });

  it('registers admin instructions, prompts and skills on the combined-lean shared stateful path', async () => {
    vi.stubEnv('TOOL_PROFILE', 'combined-lean');
    vi.stubEnv('ADMIN_TOOLS_ENABLED', 'true');
    mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(
      (featureName: string) => featureName === 'admin-tools' || featureName === 'skills-over-mcp',
    );

    const server = getServer({ shared: true });
    await server.registerTools();

    const instructions =
      (server.mcpServer.server as unknown as { _instructions?: string })._instructions ?? '';
    expect(instructions).toContain('site-administration capabilities');
    expect(vi.mocked(server.mcpServer.registerPrompt).mock.calls.map((call) => call[0])).toEqual(
      expect.arrayContaining(['stale-content-cleanup-inform', 'user-license-reclamation-apply']),
    );
    expect(server.mcpServer.server.registerCapabilities).toHaveBeenCalledWith({
      extensions: { 'io.modelcontextprotocol/skills': { directoryRead: false } },
    });
    expect(
      vi
        .mocked(server.mcpServer.registerResource)
        .mock.calls.some(([name]) => String(name).startsWith('skill://')),
    ).toBe(true);
    expect(vi.mocked(server.mcpServer.registerTool).mock.calls.map((call) => call[0])).toEqual([
      'load-web-tools',
    ]);
  });

  describe('combined-lean group loading', () => {
    const contentTool = (): WebTool<any> =>
      ({ ...createMockAdminTool(), name: 'delete-content' }) as WebTool<any>;

    async function setup(): Promise<WebMcpServer> {
      vi.stubEnv('TOOL_PROFILE', 'combined-lean');
      mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(enforceRoleRequirements);
      const server = getServer({ shared: true });
      await server.registerTools();
      return server;
    }

    const registered = (server: WebMcpServer): string[] =>
      vi.mocked(server.mcpServer.registerTool).mock.calls.map((call) => call[0]);

    it('returns the role-fetch warning in the tool result, keeps the group retryable, and leaves instructions alone', async () => {
      const server = await setup();
      const before = getInstructions(server);
      mocks.mockGetCurrentUserSiteRole.mockResolvedValue(undefined);
      vi.spyOn(webToolFactories, 'map')
        .mockReturnValueOnce([contentTool()])
        .mockReturnValueOnce([contentTool()]);

      const first = await server.loadWebTools('content');
      expect(first.status).toBe('partial');
      expect(first.toolNames).toEqual([]);
      expect(first.warnings).toEqual([
        expect.stringContaining('site role could not be determined'),
      ]);
      expect(first.warnings?.[0]).toContain('Call load-web-tools again');
      expect(first.warnings?.[0]).not.toContain('reconnect');
      expect(getInstructions(server)).toBe(before);

      mocks.mockGetCurrentUserSiteRole.mockResolvedValue('SiteAdministratorCreator');
      const second = await server.loadWebTools('content');
      expect(second.status).toBe('loaded');
      expect(second.toolNames).toEqual(['delete-content']);
      expect(second.warnings).toBeUndefined();
      expect(registered(server)).toContain('delete-content');

      const third = await server.loadWebTools('content');
      expect(third.status).toBe('already-loaded');
    });

    it('treats a tool omitted for a low role as loaded so the role is not refetched', async () => {
      const server = await setup();
      mocks.mockGetCurrentUserSiteRole.mockClear().mockResolvedValue('Viewer');
      vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([contentTool()]);

      const first = await server.loadWebTools('content');
      expect(first).toEqual({ status: 'loaded', toolNames: [] });
      const second = await server.loadWebTools('content');
      expect(second.status).toBe('already-loaded');
      expect(mocks.mockGetCurrentUserSiteRole).toHaveBeenCalledTimes(1);
    });

    it('reports a registration error as a warning and retries the group', async () => {
      const server = await setup();
      mocks.mockGetCurrentUserSiteRole.mockResolvedValue('SiteAdministratorCreator');
      vi.spyOn(webToolFactories, 'map')
        .mockReturnValueOnce([contentTool()])
        .mockReturnValueOnce([contentTool()]);
      vi.mocked(server.mcpServer.registerTool).mockImplementationOnce(() => {
        throw new Error('boom');
      });

      const first = await server.loadWebTools('content');
      expect(first.status).toBe('partial');
      expect(first.toolNames).toEqual([]);
      expect(first.warnings).toEqual([
        expect.stringContaining('Failed to register delete-content: boom'),
      ]);

      const second = await server.loadWebTools('content');
      expect(second.status).toBe('loaded');
      expect(second.toolNames).toEqual(['delete-content']);
    });

    const pulseTool = (): WebTool<any> =>
      ({
        ...createMockConditionalTool(),
        name: 'list-all-pulse-metric-definitions',
        minRequiredRole: SiteRole.VIEWER,
      }) as WebTool<any>;

    it('retries a Pulse group after an indeterminate condition probe and registers it once the probe succeeds', async () => {
      const server = await setup();
      mocks.mockFeatureGate.isFeatureEnabled.mockImplementation((name: string) =>
        enforceRegistrationConditions(name),
      );
      mocks.mockCheckRegistrationConditions
        .mockResolvedValueOnce({
          registrationConditionsMet: false,
          failingCondition: 'RequiresPulse',
          indeterminate: true,
        })
        .mockResolvedValueOnce({ registrationConditionsMet: true });
      vi.spyOn(webToolFactories, 'map')
        .mockReturnValueOnce([pulseTool()])
        .mockReturnValueOnce([pulseTool()]);

      const first = await server.loadWebTools('pulse');
      expect(first.status).toBe('partial');
      expect(first.toolNames).toEqual([]);
      expect(first.warnings).toEqual([expect.stringContaining('could not be confirmed')]);
      expect(first.notes).toBeUndefined();

      const second = await server.loadWebTools('pulse');
      expect(second.status).toBe('loaded');
      expect(second.toolNames).toEqual(['list-all-pulse-metric-definitions']);
    });

    it('reports a definitive unmet condition as a note and closes the group', async () => {
      const server = await setup();
      mocks.mockFeatureGate.isFeatureEnabled.mockImplementation((name: string) =>
        enforceRegistrationConditions(name),
      );
      mocks.mockCheckRegistrationConditions.mockResolvedValue({
        registrationConditionsMet: false,
        failingCondition: 'RequiresPulse',
      });
      vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([pulseTool()]);

      const first = await server.loadWebTools('pulse');
      expect(first.status).toBe('loaded');
      expect(first.warnings).toBeUndefined();
      expect(first.notes).toEqual([expect.stringContaining('Pulse is not available')]);
      expect((await server.loadWebTools('pulse')).status).toBe('already-loaded');
    });

    it('only reports problems for tools in the requested group', async () => {
      const server = await setup();
      mocks.mockGetCurrentUserSiteRole.mockResolvedValue(undefined);
      vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([contentTool()]);

      const result = await server.loadWebTools('datasource');

      expect(result.status).toBe('loaded');
      expect(result.warnings).toBeUndefined();
      expect(result.notes).toBeUndefined();
    });

    it('describes every group and tool in the load-web-tools description', async () => {
      const server = await setup();
      const config = vi.mocked(server.mcpServer.registerTool).mock.calls[0][1] as {
        description: string;
      };
      expect(config.description).toContain('"partial"');
      for (const [group, tools] of Object.entries(webToolGroups)) {
        expect(config.description).toContain(group);
        for (const tool of tools) {
          expect(config.description).toContain(tool);
        }
      }
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
      minRequiredRole: SiteRole.SITE_ADMINISTRATOR_EXPLORER,
      registrationConditions: [],
      requiredApiScopes: [],
      logAndExecute: vi.fn(),
      notifyInvocation: vi.fn(),
    } as unknown as WebTool<any>;
  }

  function createMockConditionalTool(): WebTool<any> {
    return {
      name: 'mock-conditional-tool' as WebToolName,
      server: {} as any,
      title: 'Mock Conditional Tool',
      description: 'Mock Conditional Tool',
      paramsSchema: {},
      annotations: {
        title: 'Mock Conditional Tool',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      callback: vi.fn(),
      disabled: false,
      minRequiredRole: SiteRole.VIEWER,
      registrationConditions: ['RequiresPulse'],
      requiredApiScopes: [],
      logAndExecute: vi.fn(),
      notifyInvocation: vi.fn(),
    } as unknown as WebTool<any>;
  }

  // The registration-time role check is gated behind the `enforce-role-requirements` flag. With the
  // flag ON the tool's minRequiredRole is enforced; with it OFF the check is skipped entirely.
  const enforceRoleRequirements = (name: string): boolean => name === 'enforce-role-requirements';

  // Companion flag for the registration-conditions check (Pulse etc.). ON enforces a tool's
  // declared `registrationConditions`; OFF skips the check entirely.
  const enforceRegistrationConditions = (name: string): boolean =>
    name === 'enforce-registration-conditions';

  it.each([
    ['omits Knowledge tools for an unlicensed user', 'Unlicensed', false, []],
    ['omits Knowledge tools for a Guest', 'Guest', false, []],
    ['omits Knowledge tools for a Support User', SiteRole.SUPPORT_USER, false, []],
    ['omits Knowledge tools for an unrecognized role', 'Unknown', false, []],
    ['omits Knowledge tools on Tableau Server', SiteRole.SERVER_ADMINISTRATOR, false, []],
    [
      'registers read only when the role lookup fails but the Knowledge read probe succeeds',
      undefined,
      true,
      ['query-knowledge-context', 'inspect-knowledge-context'],
    ],
    [
      'registers read only for a Viewer',
      SiteRole.VIEWER,
      true,
      ['query-knowledge-context', 'inspect-knowledge-context'],
    ],
    [
      'registers read only for an Explorer',
      SiteRole.EXPLORER,
      true,
      ['query-knowledge-context', 'inspect-knowledge-context'],
    ],
    [
      'registers read only for an Explorer who can publish',
      SiteRole.EXPLORER_CAN_PUBLISH,
      true,
      ['query-knowledge-context', 'inspect-knowledge-context'],
    ],
    [
      'registers read and manage for a Creator',
      SiteRole.CREATOR,
      true,
      ['query-knowledge-context', 'inspect-knowledge-context', 'manage-knowledge-context'],
    ],
    [
      'registers read and manage for a Site Administrator Explorer',
      SiteRole.SITE_ADMINISTRATOR_EXPLORER,
      true,
      ['query-knowledge-context', 'inspect-knowledge-context', 'manage-knowledge-context'],
    ],
    [
      'registers read and manage for a Site Administrator Creator',
      SiteRole.SITE_ADMINISTRATOR_CREATOR,
      true,
      ['query-knowledge-context', 'inspect-knowledge-context', 'manage-knowledge-context'],
    ],
    [
      'omits Knowledge tools when Knowledge is unavailable on the site',
      SiteRole.CREATOR,
      false,
      [],
    ],
  ] as const)('%s', async (_, siteRole, knowledgeAvailable, expectedTools) => {
    mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(
      (name: string) =>
        name === 'knowledge-tools' ||
        name === 'knowledge-write-tools' ||
        enforceRoleRequirements(name) ||
        enforceRegistrationConditions(name),
    );
    mocks.mockGetCurrentUserSiteRole.mockResolvedValue(siteRole);
    mocks.mockCheckRegistrationConditions.mockResolvedValue(
      knowledgeAvailable
        ? { registrationConditionsMet: true }
        : { registrationConditionsMet: false, failingCondition: 'RequiresKnowledge' },
    );

    const server = getServer();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([
      getQueryKnowledgeContextTool(server),
      getInspectKnowledgeContextTool(server),
      getManageKnowledgeContextTool(server),
    ]);

    await server.registerTools();

    expect(server.mcpServer.registerTool).toHaveBeenCalledTimes(expectedTools.length);
    for (const toolName of expectedTools) {
      expect(server.mcpServer.registerTool).toHaveBeenCalledWith(
        toolName,
        expect.anything(),
        expect.any(Function),
      );
    }
  });

  it('omits Knowledge tools when the knowledge-tools feature flag is off', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(
      (name: string) => enforceRoleRequirements(name) || enforceRegistrationConditions(name),
    );
    mocks.mockGetCurrentUserSiteRole.mockResolvedValue(SiteRole.CREATOR);
    mocks.mockCheckRegistrationConditions.mockResolvedValue({ registrationConditionsMet: true });

    const server = getServer();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([
      getQueryKnowledgeContextTool(server),
      getInspectKnowledgeContextTool(server),
      getManageKnowledgeContextTool(server),
    ]);

    await server.registerTools();

    expect(server.mcpServer.registerTool).not.toHaveBeenCalled();
  });

  it('registers only Knowledge read tools when the write flag is off', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(
      (name: string) =>
        name === 'knowledge-tools' ||
        enforceRoleRequirements(name) ||
        enforceRegistrationConditions(name),
    );
    mocks.mockGetCurrentUserSiteRole.mockResolvedValue(SiteRole.CREATOR);
    mocks.mockCheckRegistrationConditions.mockResolvedValue({ registrationConditionsMet: true });

    const server = getServer();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([
      getQueryKnowledgeContextTool(server),
      getInspectKnowledgeContextTool(server),
      getManageKnowledgeContextTool(server),
    ]);

    await server.registerTools();

    expect(server.mcpServer.registerTool).toHaveBeenCalledTimes(2);
    expect(server.mcpServer.registerTool).toHaveBeenCalledWith(
      'query-knowledge-context',
      expect.anything(),
      expect.any(Function),
    );
    expect(server.mcpServer.registerTool).toHaveBeenCalledWith(
      'inspect-knowledge-context',
      expect.anything(),
      expect.any(Function),
    );
  });

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

  it('registers a Viewer-minimum tool even when the role fetch failed (Viewer is never enforced)', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(enforceRoleRequirements);
    // Fetch failed (undefined): an above-Viewer tool would be omitted, but a Viewer minimum is
    // satisfied by every authenticated caller, so enforcement is skipped for it entirely.
    mocks.mockGetCurrentUserSiteRole.mockResolvedValue(undefined);

    const server = getServer();
    const mockViewerTool = {
      ...createMockAdminTool(),
      name: 'mock-viewer-tool' as WebToolName,
      minRequiredRole: SiteRole.VIEWER,
    } as unknown as WebTool<any>;
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([mockViewerTool]);

    await server.registerTools();

    expect(server.mcpServer.registerTool).toHaveBeenCalledWith(
      'mock-viewer-tool',
      expect.anything(),
      expect.any(Function),
    );
    // The tool was registered, not omitted, so no "role could not be determined" warning is emitted.
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

  it('logs a telemetry warning naming the tools omitted for unmet conditions and the failing condition', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(enforceRegistrationConditions);
    mocks.mockCheckRegistrationConditions.mockResolvedValue({
      registrationConditionsMet: false,
      failingCondition: 'RequiresPulse',
    });

    const server = getServer();
    const mockConditionalTool = createMockConditionalTool();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([mockConditionalTool]);

    await server.registerTools();

    expect(server.mcpServer.registerTool).not.toHaveBeenCalledWith(
      'mock-conditional-tool',
      expect.anything(),
      expect.anything(),
    );
    const warnings = getWarningLogs();
    expect(warnings).toHaveLength(1);
    // Names the omitted tool and the condition it failed, so operators can see what was hidden and why.
    expect(warnings[0].message).toContain('mock-conditional-tool');
    expect(warnings[0].message).toContain('RequiresPulse');
  });

  it('registers a conditional tool when its conditions are met', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(enforceRegistrationConditions);
    mocks.mockCheckRegistrationConditions.mockResolvedValue({ registrationConditionsMet: true });

    const server = getServer();
    const mockConditionalTool = createMockConditionalTool();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([mockConditionalTool]);

    await server.registerTools();

    expect(server.mcpServer.registerTool).toHaveBeenCalledWith(
      'mock-conditional-tool',
      expect.anything(),
      expect.any(Function),
    );
    expect(getWarningLogs()).toHaveLength(0);
  });

  it('does not check conditions or warn when enforce-registration-conditions is off', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockReturnValue(false);

    const server = getServer();
    const mockConditionalTool = createMockConditionalTool();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([mockConditionalTool]);

    await server.registerTools();

    // With the flag off, conditions are not evaluated: the tool registers and nothing is logged.
    expect(server.mcpServer.registerTool).toHaveBeenCalledWith(
      'mock-conditional-tool',
      expect.anything(),
      expect.any(Function),
    );
    expect(mocks.mockCheckRegistrationConditions).not.toHaveBeenCalled();
    expect(getWarningLogs()).toHaveLength(0);
  });

  it('explains in the connect instructions why Pulse tools were omitted', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(enforceRegistrationConditions);
    mocks.mockCheckRegistrationConditions.mockResolvedValue({
      registrationConditionsMet: false,
      failingCondition: 'RequiresPulse',
    });

    const server = getServer();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([createMockConditionalTool()]);

    await server.registerTools();

    // Without this the caller just sees a short tool list and no reason for it.
    const instructions = getInstructions(server);
    expect(instructions).toContain('Pulse is not available');
    expect(instructions).toContain(
      'https://help.tableau.com/current/online/en-us/pulse_set_up.htm',
    );
  });

  it('does not mention Pulse in the connect instructions when conditions are met', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(enforceRegistrationConditions);
    mocks.mockCheckRegistrationConditions.mockResolvedValue({ registrationConditionsMet: true });

    const server = getServer();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([createMockConditionalTool()]);

    await server.registerTools();

    expect(getInstructions(server)).not.toContain('Pulse is not available');
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

  it('should register as standard tool when flag is off even if client is UI-capable', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockReturnValue(false);

    const server = getServer({ capabilities: uiCapableClientCapabilities });
    const mockAppTool = createMockAppTool();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([mockAppTool]);

    await server.registerTools();

    expect(server.mcpServer.registerTool).toHaveBeenCalledWith(
      'mock-app-tool',
      expect.any(Object),
      expect.any(Function),
    );
    expect(mocks.mockRegisterAppTool).not.toHaveBeenCalled();
    expect(mocks.mockRegisterAppResource).not.toHaveBeenCalled();
  });

  it('should register as standard tool for a known-incompatible client (claude.ai) despite UI support', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockReturnValue(true);

    // Flag on + UI-capable, but clientId resolves to 'Claude' via getClientDisplayName → plain tool.
    const server = getServer({
      capabilities: uiCapableClientCapabilities,
      clientId: 'https://claude.ai/some/cimd',
    });
    const mockAppTool = createMockAppTool();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([mockAppTool]);

    await server.registerTools();

    expect(server.mcpServer.registerTool).toHaveBeenCalledWith(
      'mock-app-tool',
      expect.any(Object),
      expect.any(Function),
    );
    expect(mocks.mockRegisterAppTool).not.toHaveBeenCalled();
    expect(mocks.mockRegisterAppResource).not.toHaveBeenCalled();
  });

  it('should register app tool for a non-Claude known client (Cursor) that is UI-capable', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockReturnValue(true);

    const server = getServer({
      capabilities: uiCapableClientCapabilities,
      clientId: 'https://cursor.com/some/cimd',
    });
    const mockAppTool = createMockAppTool();
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([mockAppTool]);

    await server.registerTools();

    expect(mocks.mockRegisterAppTool).toHaveBeenCalledWith(
      server.mcpServer,
      'mock-app-tool',
      expect.any(Object),
      expect.any(Function),
    );
    expect(mocks.mockRegisterAppResource).toHaveBeenCalled();
  });

  it('should not register a hideWhenUnsupported app tool for the known-incompatible client (claude.ai)', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockReturnValue(true);

    // UI-capable but claude.ai → app path is blocked; hideWhenUnsupported means no plain fallback either.
    const server = getServer({
      capabilities: uiCapableClientCapabilities,
      clientId: 'https://claude.ai/some/cimd',
    });
    const mockAppTool = createMockAppTool({ hideWhenUnsupported: true });
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([mockAppTool]);

    await server.registerTools();

    expect(server.mcpServer.registerTool).not.toHaveBeenCalledWith(
      'mock-app-tool',
      expect.anything(),
      expect.anything(),
    );
    expect(mocks.mockRegisterAppTool).not.toHaveBeenCalled();
    expect(mocks.mockRegisterAppResource).not.toHaveBeenCalled();
  });

  it('should still register a hideWhenUnsupported app tool as an app tool when the client supports MCP Apps', async () => {
    mocks.mockFeatureGate.isFeatureEnabled.mockReturnValue(true);

    // hideWhenUnsupported only changes the fallback; the happy path still registers it as an app tool.
    const server = getServer({ capabilities: uiCapableClientCapabilities });
    const mockAppTool = createMockAppTool({ hideWhenUnsupported: true });
    vi.spyOn(webToolFactories, 'map').mockReturnValueOnce([mockAppTool]);

    await server.registerTools();

    expect(mocks.mockRegisterAppTool).toHaveBeenCalledWith(
      server.mcpServer,
      'mock-app-tool',
      expect.any(Object),
      expect.any(Function),
    );
    expect(mocks.mockRegisterAppResource).toHaveBeenCalled();
    expect(server.mcpServer.registerTool).not.toHaveBeenCalledWith(
      'mock-app-tool',
      expect.anything(),
      expect.anything(),
    );
  });
});

// Connection mutation is hidden below the administrator role even when flow writes are enabled.
describe('flow connection update registration contract', () => {
  it('declares an administrator minimum role', () => {
    const tool = getUpdateFlowConnectionTool(new WebMcpServer());
    expect(tool?.minRequiredRole).toBe(SiteRole.SITE_ADMINISTRATOR_EXPLORER);
  });
});
