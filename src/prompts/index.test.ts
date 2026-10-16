import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer as McpServerType } from '@modelcontextprotocol/sdk/server/mcp.js';
import { UriTemplate } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../server.web.js';
import { stubDefaultEnvVars } from '../testShared.js';
import {
  ADMIN_WORKFLOW_RESOURCE_URI_PREFIX,
  getAdminWorkflowResourceUri,
  getEnabledWebPrompts,
  registerPrompts,
} from './index.js';

const mocks = vi.hoisted(() => ({
  mockFeatureGate: { isFeatureEnabled: vi.fn(async (_featureName: string) => false) },
}));

vi.mock('../features/init.js', () => ({
  getFeatureGate: vi.fn(() => mocks.mockFeatureGate),
}));

const adminPromptNames = [
  'stale-content-cleanup-inform',
  'stale-content-cleanup-apply',
  'job-optimization-inform',
  'extract-optimization-apply',
  'user-license-reclamation-inform',
  'user-license-reclamation-apply',
];

// testSetup.ts globally mocks McpServer; these tests need the real SDK so resources/list and
// resources/read go through the SDK's actual request handlers.
async function getRealMcpServer(): Promise<McpServerType> {
  const { McpServer } = await vi.importActual<
    typeof import('@modelcontextprotocol/sdk/server/mcp.js')
  >('@modelcontextprotocol/sdk/server/mcp.js');
  return new McpServer({ name: 'test', version: '0.0.0' });
}

async function connect(mcpServer: McpServerType): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function enableAdminTools(): void {
  vi.stubEnv('ADMIN_TOOLS_ENABLED', 'true');
  mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(
    async (featureName: string) => featureName === 'admin-tools',
  );
}

describe('admin workflow prompts and resources', () => {
  let mcpServer: McpServerType;
  let server: WebMcpServer;

  beforeEach(async () => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    mocks.mockFeatureGate.isFeatureEnabled.mockReset().mockResolvedValue(false);
    mcpServer = await getRealMcpServer();
    server = { mcpServer } as unknown as WebMcpServer;
    // License prompts compute date-relative text; freeze the clock so prompt and resource renders match.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('getEnabledWebPrompts returns every admin prompt when admin tools are enabled', async () => {
    enableAdminTools();
    const prompts = await getEnabledWebPrompts(server);
    expect(prompts.map((p) => p.name)).toEqual(adminPromptNames);
  });

  it('getEnabledWebPrompts returns every admin prompt when only ADMIN_TOOLS_ENABLED is set (admin-tools flag off)', async () => {
    vi.stubEnv('ADMIN_TOOLS_ENABLED', 'true');
    const prompts = await getEnabledWebPrompts(server);
    expect(prompts.map((p) => p.name)).toEqual(adminPromptNames);
  });

  it('getEnabledWebPrompts returns every admin prompt when only the admin-tools flag is on (ADMIN_TOOLS_ENABLED unset)', async () => {
    vi.stubEnv('ADMIN_TOOLS_ENABLED', undefined);
    mocks.mockFeatureGate.isFeatureEnabled.mockImplementation(
      async (featureName: string) => featureName === 'admin-tools',
    );
    const prompts = await getEnabledWebPrompts(server);
    expect(prompts.map((p) => p.name)).toEqual(adminPromptNames);
  });

  it('getEnabledWebPrompts returns nothing when admin tools are disabled (both the env var and the flag off)', async () => {
    vi.stubEnv('ADMIN_TOOLS_ENABLED', undefined);
    expect(await getEnabledWebPrompts(server)).toEqual([]);
  });

  it('registers one text/markdown workflow resource per enabled prompt', async () => {
    enableAdminTools();
    await registerPrompts(server);
    const client = await connect(mcpServer);

    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(adminPromptNames.map(getAdminWorkflowResourceUri));
    const { prompts } = await client.listPrompts();
    for (const resource of resources) {
      const prompt = prompts.find((p) => p.name === resource.name);
      expect(prompt).toBeDefined();
      expect(resource.uri).toBe(`${ADMIN_WORKFLOW_RESOURCE_URI_PREFIX}${prompt!.name}`);
      expect(resource.mimeType).toBe('text/markdown');
      expect(resource.title).toBe(prompt!.title);
      expect(resource.description).toBe(prompt!.description);
    }
  });

  it.each(adminPromptNames)(
    'resources/read of %s returns exactly the prompts/get text with default args',
    async (name) => {
      enableAdminTools();
      await registerPrompts(server);
      const client = await connect(mcpServer);

      const uri = getAdminWorkflowResourceUri(name);
      const read = await client.readResource({ uri });
      const promptResult = await client.getPrompt({ name, arguments: {} });
      const promptText = promptResult.messages
        .map((m) => (m.content.type === 'text' ? m.content.text : ''))
        .join('\n\n');

      expect(read.contents).toHaveLength(1);
      expect(read.contents[0]).toEqual({ uri, mimeType: 'text/markdown', text: promptText });
      expect(promptText).toContain(name);
    },
  );

  it('registers no prompts or resources when admin tools are disabled', async () => {
    await registerPrompts(server);
    const client = await connect(mcpServer);

    // With nothing registered the SDK advertises neither capability.
    expect(client.getServerCapabilities()?.resources).toBeUndefined();
    expect(client.getServerCapabilities()?.prompts).toBeUndefined();
  });

  it('returns a clean InvalidParams error for an unknown workflow URI', async () => {
    enableAdminTools();
    await registerPrompts(server);
    const client = await connect(mcpServer);

    await expect(
      client.readResource({ uri: getAdminWorkflowResourceUri('not-a-workflow') }),
    ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
  });

  it('is idempotent on a shared McpServer (no duplicate-registration throw)', async () => {
    enableAdminTools();
    await registerPrompts(server);
    await expect(registerPrompts(server)).resolves.toBeUndefined();
    const client = await connect(mcpServer);

    const { resources } = await client.listResources();
    expect(resources).toHaveLength(adminPromptNames.length);
  });

  it('coexists with other registered resources (e.g. skill:// files)', async () => {
    enableAdminTools();
    mcpServer.registerResource('skill://demo/SKILL.md', 'skill://demo/SKILL.md', {}, async () => ({
      contents: [{ uri: 'skill://demo/SKILL.md', text: 'demo' }],
    }));
    await registerPrompts(server);
    const client = await connect(mcpServer);

    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual([
      'skill://demo/SKILL.md',
      ...adminPromptNames.map(getAdminWorkflowResourceUri),
    ]);
  });

  it('registers no tools (tools/list is unchanged by workflow resources)', async () => {
    enableAdminTools();
    const registerTool = vi.spyOn(mcpServer, 'registerTool');
    await registerPrompts(server);
    expect(registerTool).not.toHaveBeenCalled();
  });

  // Documents why argument-bearing resource templates are NOT registered: the SDK's RFC 6570
  // `{?a,b}` matching is too strict to be usable. If this starts failing, the SDK has improved and
  // templates can be reconsidered.
  it('SDK UriTemplate query matching is unreliable for optional args', () => {
    const template = new UriTemplate(
      `${ADMIN_WORKFLOW_RESOURCE_URI_PREFIX}user-license-reclamation-inform{?inactiveDays,roles}`,
    );
    const base = getAdminWorkflowResourceUri('user-license-reclamation-inform');
    expect(template.match(`${base}?inactiveDays=30&roles=Creator`)).toEqual({
      inactiveDays: '30',
      roles: 'Creator',
    });
    // A single optional arg, or args in a different order, do not match.
    expect(template.match(`${base}?inactiveDays=30`)).toBeNull();
    expect(template.match(`${base}?roles=Creator&inactiveDays=30`)).toBeNull();
    // The template's own expansion of a comma-separated value comes back still percent-encoded.
    expect(
      template.match(template.expand({ inactiveDays: '30', roles: 'Creator,Explorer' })),
    ).toEqual({ inactiveDays: '30', roles: 'Creator%2CExplorer' });
  });
});
