import { describe, expect, it, vi } from 'vitest';

import * as configModule from '../../config.js';
import {
  getAlwaysRequiredApiScopes,
  getRequiredApiScopesForTool,
  getRequiredMcpScopesForTool,
  getRequiredScopesForTool,
  getSupportedApiScopes,
  getSupportedMcpScopes,
  getSupportedScopes,
  isValidScope,
} from './scopes.js';

const mocks = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
  mockGetTableauServerInfo: vi.fn(),
}));

vi.mock('../../config.js', () => ({
  getConfig: vi.fn(),
}));

vi.mock('../../getTableauServerInfo.js', () => ({
  getTableauServerInfo: mocks.mockGetTableauServerInfo,
}));

vi.mock('../../features/init.js', () => ({
  getFeatureGate: () => ({
    isFeatureEnabled: mocks.mockIsFeatureEnabled,
  }),
}));

const mockGetConfig = vi.mocked(configModule.getConfig);

// Authoring scopes are advertised for every client except Slack, which requires
// authoring-with-slack. Undefined client_id (stdio) and
// unknown/non-Slack clients are allowed.
const chatGptClientId = 'https://chatgpt.com/connector';
const claudeClientId = 'https://claude.ai/mcp';
const slackClientId = 'https://mcp.slack.com/connector';
const unknownClientId = 'https://example.com/mcp';

describe('scopes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);
    mocks.mockGetTableauServerInfo.mockResolvedValue({
      productVersion: { value: '2026.3.0', build: '' },
    });
  });

  describe('datasource publishing scopes', () => {
    it.each([
      {
        client: 'stdio',
        clientId: undefined,
        datasourceAuthoring: true,
        slackAuthoring: false,
        enabled: true,
      },
      {
        client: 'ChatGPT',
        clientId: chatGptClientId,
        datasourceAuthoring: true,
        slackAuthoring: false,
        enabled: true,
      },
      {
        client: 'Claude',
        clientId: claudeClientId,
        datasourceAuthoring: true,
        slackAuthoring: false,
        enabled: true,
      },
      {
        client: 'unknown',
        clientId: unknownClientId,
        datasourceAuthoring: true,
        slackAuthoring: false,
        enabled: true,
      },
      {
        client: 'ChatGPT',
        clientId: chatGptClientId,
        datasourceAuthoring: false,
        slackAuthoring: false,
        enabled: false,
      },
      {
        client: 'Slack',
        clientId: slackClientId,
        datasourceAuthoring: true,
        slackAuthoring: false,
        enabled: false,
      },
      {
        client: 'Slack',
        clientId: slackClientId,
        datasourceAuthoring: true,
        slackAuthoring: true,
        enabled: true,
      },
      {
        client: 'Slack',
        clientId: slackClientId,
        datasourceAuthoring: false,
        slackAuthoring: true,
        enabled: false,
      },
    ])(
      'advertises datasource scopes=$enabled for $client with datasource-authoring=$datasourceAuthoring and Slack authoring=$slackAuthoring',
      async ({ clientId, datasourceAuthoring, slackAuthoring, enabled }) => {
        mocks.mockIsFeatureEnabled.mockImplementation(async (featureName: string) => {
          return (
            (featureName === 'datasource-authoring' && datasourceAuthoring) ||
            (featureName === 'authoring-with-slack' && slackAuthoring)
          );
        });
        mockGetConfig.mockReturnValue({ adminToolsEnabled: false } as any);

        const mcpScopes = await getSupportedMcpScopes(clientId);
        const apiScopes = await getSupportedApiScopes(clientId);

        expect(mcpScopes.includes('tableau:mcp:datasource:create')).toBe(enabled);
        expect(apiScopes.includes('tableau:datasources:create')).toBe(enabled);
        await expect(isValidScope('tableau:mcp:datasource:create', clientId)).resolves.toBe(
          enabled,
        );
      },
    );

    it.each([false, true])(
      'advertises workbook publishing scopes whatever datasource-authoring is (%s)',
      async (datasourceAuthoring) => {
        mocks.mockIsFeatureEnabled.mockImplementation(
          async (featureName: string) =>
            featureName === 'datasource-authoring' && datasourceAuthoring,
        );
        mockGetConfig.mockReturnValue({ adminToolsEnabled: false } as any);

        const mcpScopes = await getSupportedMcpScopes(chatGptClientId);

        expect(mcpScopes.includes('tableau:mcp:workbook:create')).toBe(true);
        expect(mcpScopes.includes('tableau:mcp:datasource:create')).toBe(datasourceAuthoring);
      },
    );

    it.each(['request-datasource-upload', 'publish-datasource'] as const)(
      'requires the datasource create MCP permission for %s',
      (toolName) => {
        mockGetConfig.mockReturnValue({ oauth: { enforceScopes: true } } as any);
        expect(getRequiredScopesForTool(toolName)).toEqual(['tableau:mcp:datasource:create']);
      },
    );

    it.each(['request-datasource-upload', 'publish-datasource'] as const)(
      'reports the datasource create MCP scope for %s regardless of enforceScopes',
      (toolName) => {
        // Unlike getRequiredScopesForTool (which returns [] when enforcement is off), the
        // registration-time getter always reports the declared MCP scopes so tool omission can
        // decide whether the caller's grant authorizes the tool at the MCP layer.
        mockGetConfig.mockReturnValue({ oauth: { enforceScopes: false } } as any);
        expect(getRequiredScopesForTool(toolName)).toEqual([]);
        expect(getRequiredMcpScopesForTool(toolName)).toEqual(['tableau:mcp:datasource:create']);
      },
    );

    it('requires datasource and file upload API permissions when publishing', () => {
      expect(getRequiredApiScopesForTool('publish-datasource')).toEqual([
        'tableau:datasources:create',
        'tableau:file_uploads:create',
      ]);
    });

    it('requires no Tableau API permissions to request an S3 upload URL', () => {
      expect(getRequiredApiScopesForTool('request-datasource-upload')).toEqual([]);
    });
  });

  describe('getSupportedMcpScopes', () => {
    it('should include tableau:mcp:tasks:read when adminToolsEnabled and admin-tools are both on', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => featureName === 'admin-tools',
      );
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).toContain('tableau:mcp:tasks:read');
    });

    it('should exclude tableau:mcp:tasks:read when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).not.toContain('tableau:mcp:tasks:read');
    });

    it('should include tableau:mcp:tasks:write when adminToolsEnabled and admin-tools are both on', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => featureName === 'admin-tools',
      );
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).toContain('tableau:mcp:tasks:write');
    });

    it('should exclude tableau:mcp:tasks:write when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).not.toContain('tableau:mcp:tasks:write');
    });

    it('should include tableau:mcp:jobs:read when adminToolsEnabled and admin-tools are both on', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => featureName === 'admin-tools',
      );
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).toContain('tableau:mcp:jobs:read');
    });

    it('should exclude tableau:mcp:jobs:read when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).not.toContain('tableau:mcp:jobs:read');
    });

    it('should include tableau:mcp:users:write when adminToolsEnabled and admin-tools are both on', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => featureName === 'admin-tools',
      );
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).toContain('tableau:mcp:users:write');
    });

    it('should exclude tableau:mcp:users:write when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).not.toContain('tableau:mcp:users:write');
    });

    it('should exclude tableau:mcp:content:delete when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).not.toContain('tableau:mcp:content:delete');
    });

    it('should include tableau:mcp:content:delete when adminToolsEnabled and admin-tools are both on', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => featureName === 'admin-tools',
      );
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).toContain('tableau:mcp:content:delete');
    });

    it('should include admin MCP scopes when the admin-tools flag is on even if adminToolsEnabled is false', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => featureName === 'admin-tools',
      );
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).toContain('tableau:mcp:tasks:read');
      expect(scopes).toContain('tableau:mcp:tasks:write');
      expect(scopes).toContain('tableau:mcp:jobs:read');
      expect(scopes).toContain('tableau:mcp:users:write');
      expect(scopes).toContain('tableau:mcp:content:delete');
    });

    it('should include admin MCP scopes when adminToolsEnabled is true even if the admin-tools flag is off', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).toContain('tableau:mcp:tasks:read');
      expect(scopes).toContain('tableau:mcp:tasks:write');
      expect(scopes).toContain('tableau:mcp:jobs:read');
      expect(scopes).toContain('tableau:mcp:users:write');
      expect(scopes).toContain('tableau:mcp:content:delete');
    });

    it('should include tableau:mcp:flow:read when the flow-read-tools flag is on and FLOW_READ_TOOLS_ENABLED is unset', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => featureName === 'flow-read-tools',
      );
      mockGetConfig.mockReturnValue({} as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).toContain('tableau:mcp:flow:read');
    });

    it('should include tableau:mcp:flow:read when flowReadToolsEnabled is true but the flag is disabled', async () => {
      mockGetConfig.mockReturnValue({
        flowReadToolsEnabled: true,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).toContain('tableau:mcp:flow:read');
    });

    it('should exclude tableau:mcp:flow:read when flowReadToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        flowReadToolsEnabled: false,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).not.toContain('tableau:mcp:flow:read');
    });

    it('should include tableau:mcp:workbook:create for ChatGPT', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedMcpScopes(chatGptClientId);
      expect(scopes).toContain('tableau:mcp:workbook:create');
    });

    it('should include tableau:mcp:workbook:create when there is no OAuth client id (stdio)', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedMcpScopes(undefined);
      expect(scopes).toContain('tableau:mcp:workbook:create');
    });

    it('should include tableau:mcp:workbook:create for a non-Slack client', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedMcpScopes(claudeClientId);
      expect(scopes).toContain('tableau:mcp:workbook:create');
    });

    it('should include tableau:mcp:workbook:create for an unknown client', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedMcpScopes(unknownClientId);
      expect(scopes).toContain('tableau:mcp:workbook:create');
    });

    it('should exclude tableau:mcp:workbook:create for Slack', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedMcpScopes(slackClientId);
      expect(scopes).not.toContain('tableau:mcp:workbook:create');
    });

    it('should include tableau:mcp:workbook:create for Slack when authoring-with-slack is enabled', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(async (featureName: string) => {
        return featureName === 'authoring-with-slack';
      });
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedMcpScopes(slackClientId);
      expect(scopes).toContain('tableau:mcp:workbook:create');
    });

    it('should exclude tableau:mcp:workbook:write when data-apps is disabled', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedMcpScopes(claudeClientId);
      expect(scopes).not.toContain('tableau:mcp:workbook:write');
    });

    it('should include tableau:mcp:workbook:write when data-apps is enabled', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(async (featureName: string) => {
        return featureName === 'data-apps';
      });
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedMcpScopes(claudeClientId);
      expect(scopes).toContain('tableau:mcp:workbook:write');
    });

    it('should always include other MCP scopes regardless of adminToolsEnabled', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).toContain('tableau:mcp:datasource:read');
      expect(scopes).toContain('tableau:mcp:workbook:read');
      expect(scopes).toContain('tableau:mcp:view:read');
      expect(scopes).toContain('tableau:mcp:view:download');
      expect(scopes).toContain('tableau:mcp:pulse:read');
      expect(scopes).toContain('tableau:mcp:insight:create');
      expect(scopes).toContain('tableau:mcp:content:read');
    });

    it('should advertise the Knowledge read scope when only read tools are enabled', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => featureName === 'knowledge-tools',
      );
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).toContain('tableau:mcp:knowledge:read');
      expect(scopes).not.toContain('tableau:mcp:knowledge:write');
    });

    it('should advertise both Knowledge scopes when write tools are enabled', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) =>
          featureName === 'knowledge-tools' || featureName === 'knowledge-write-tools',
      );

      const scopes = await getSupportedMcpScopes();
      expect(scopes).toContain('tableau:mcp:knowledge:read');
      expect(scopes).toContain('tableau:mcp:knowledge:write');
    });

    it('should not advertise Knowledge scopes when knowledge-tools is disabled', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).not.toContain('tableau:mcp:knowledge:read');
      expect(scopes).not.toContain('tableau:mcp:knowledge:write');
    });
  });

  describe('getSupportedApiScopes', () => {
    it.each([
      { enabled: false, clientId: claudeClientId, expected: true },
      { enabled: true, clientId: claudeClientId, expected: true },
      { enabled: true, clientId: undefined, expected: true },
      { enabled: true, clientId: slackClientId, expected: false },
      {
        enabled: true,
        clientId: slackClientId,
        authoringWithSlack: true,
        expected: true,
      },
    ])(
      'advertises permissions scope only for enabled publishing: $enabled, $clientId, $authoringWithSlack',
      async ({ enabled, clientId, authoringWithSlack, expected }) => {
        mockGetConfig.mockReturnValue({} as ReturnType<typeof configModule.getConfig>);
        mocks.mockIsFeatureEnabled.mockImplementation(async (flag) => {
          if (flag === 'data-apps') return enabled;
          if (flag === 'authoring-with-slack') return authoringWithSlack ?? false;
          return false;
        });

        const scopes = await getSupportedApiScopes(clientId);

        expect(scopes.includes('tableau:permissions:read')).toBe(expected);
      },
    );

    it.each([false, true])(
      'omits optional permissions scope when requested, data-apps=%s',
      async (enabled) => {
        mockGetConfig.mockReturnValue({} as ReturnType<typeof configModule.getConfig>);
        mocks.mockIsFeatureEnabled.mockImplementation(
          async (flag) => flag === 'data-apps' && enabled,
        );
        const scopes = await getSupportedApiScopes(claudeClientId, {
          includeOptionalScopes: false,
        });
        expect(scopes).not.toContain('tableau:permissions:read');
      },
    );

    it('should advertise only the Knowledge read API scope when write tools are off', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => featureName === 'knowledge-tools',
      );
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).toContain('tableau:knowledge:read');
      expect(scopes).not.toContain('tableau:knowledge:write');
    });

    it('should advertise both Knowledge API scopes when write tools are enabled', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) =>
          featureName === 'knowledge-tools' || featureName === 'knowledge-write-tools',
      );

      const scopes = await getSupportedApiScopes();
      expect(scopes).toContain('tableau:knowledge:read');
      expect(scopes).toContain('tableau:knowledge:write');
    });

    it('should not advertise Knowledge API scopes when knowledge-tools is disabled', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).not.toContain('tableau:knowledge:read');
      expect(scopes).not.toContain('tableau:knowledge:write');
    });

    it('should include tableau:tasks:read when adminToolsEnabled and admin-tools are both on', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => featureName === 'admin-tools',
      );
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).toContain('tableau:tasks:read');
    });

    it('should include admin API scopes when the admin-tools flag is on even if adminToolsEnabled is false', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => featureName === 'admin-tools',
      );
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).toContain('tableau:tasks:read');
      expect(scopes).toContain('tableau:tasks:write');
      expect(scopes).toContain('tableau:jobs:read');
      expect(scopes).toContain('tableau:users:read');
      expect(scopes).toContain('tableau:users:update');
    });

    it('should exclude tableau:tasks:read when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).not.toContain('tableau:tasks:read');
    });

    it('should include tableau:tasks:write when adminToolsEnabled and admin-tools are both on', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => featureName === 'admin-tools',
      );
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).toContain('tableau:tasks:write');
    });

    it('should exclude tableau:tasks:write when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).not.toContain('tableau:tasks:write');
    });

    it('should include tableau:jobs:read when adminToolsEnabled and admin-tools are both on', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => featureName === 'admin-tools',
      );
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).toContain('tableau:jobs:read');
    });

    it('should exclude tableau:jobs:read when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).not.toContain('tableau:jobs:read');
    });

    it('should include tableau:users:read when adminToolsEnabled and admin-tools are both on', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => featureName === 'admin-tools',
      );
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).toContain('tableau:users:read');
    });

    it('should exclude tableau:users:read when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).not.toContain('tableau:users:read');
    });

    it('should include tableau:flows:read when the flow-read-tools flag is on and FLOW_READ_TOOLS_ENABLED is unset', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => featureName === 'flow-read-tools',
      );
      mockGetConfig.mockReturnValue({} as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).toContain('tableau:flows:read');
    });

    it('should include tableau:flows:read when flowReadToolsEnabled is true but the flag is disabled', async () => {
      mockGetConfig.mockReturnValue({
        flowReadToolsEnabled: true,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).toContain('tableau:flows:read');
    });

    it('should exclude tableau:flows:read when flowReadToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        flowReadToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).not.toContain('tableau:flows:read');
    });

    it('should include tableau:flows:download when the flow-read-tools flag is on and FLOW_READ_TOOLS_ENABLED is unset', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => featureName === 'flow-read-tools',
      );
      mockGetConfig.mockReturnValue({} as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).toContain('tableau:flows:download');
    });

    it('should exclude tableau:flows:download when flowReadToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        flowReadToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).not.toContain('tableau:flows:download');
    });

    it('should include tableau:workbooks:create for ChatGPT', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes(chatGptClientId);
      expect(scopes).toContain('tableau:workbooks:create');
    });

    it('should include tableau:workbooks:create when there is no OAuth client id (stdio)', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes(undefined);
      expect(scopes).toContain('tableau:workbooks:create');
    });

    it('should include tableau:workbooks:create for a non-Slack client', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes(claudeClientId);
      expect(scopes).toContain('tableau:workbooks:create');
    });

    it('should include tableau:workbooks:create for an unknown client', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes(unknownClientId);
      expect(scopes).toContain('tableau:workbooks:create');
    });

    it('should exclude tableau:workbooks:create for Slack', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes(slackClientId);
      expect(scopes).not.toContain('tableau:workbooks:create');
    });

    it('should include tableau:workbooks:create for Slack when authoring-with-slack is enabled', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(async (featureName: string) => {
        return featureName === 'authoring-with-slack';
      });
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes(slackClientId);
      expect(scopes).toContain('tableau:workbooks:create');
    });

    it('should exclude tableau:workbooks:update when data-apps is disabled', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes(claudeClientId);
      expect(scopes).not.toContain('tableau:workbooks:update');
    });

    it('should include tableau:workbooks:update when data-apps is enabled', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(async (featureName: string) => {
        return featureName === 'data-apps';
      });
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes(claudeClientId);
      expect(scopes).toContain('tableau:workbooks:update');
    });

    it.each([
      { clientId: claudeClientId, flags: ['data-apps'], version: '2026.3.0', expected: true },
      { clientId: undefined, flags: ['data-apps'], version: '2026.3.0', expected: true },
      { clientId: slackClientId, flags: ['data-apps'], version: '2026.3.0', expected: false },
      {
        clientId: slackClientId,
        flags: ['data-apps', 'authoring-with-slack'],
        version: '2026.3.0',
        expected: true,
      },
      { clientId: claudeClientId, flags: [], version: '2026.3.0', expected: false },
      { clientId: claudeClientId, flags: ['data-apps'], version: '2026.2.0', expected: false },
      {
        clientId: slackClientId,
        flags: ['data-apps', 'authoring-with-slack'],
        version: '2026.2.0',
        expected: false,
      },
    ])(
      'advertises scaffold-data-app scope: $clientId, flags=$flags, version=$version',
      async ({ clientId, flags, version, expected }) => {
        mocks.mockIsFeatureEnabled.mockImplementation(async (flag: string) => flags.includes(flag));
        mocks.mockGetTableauServerInfo.mockResolvedValue({
          productVersion: { value: version, build: '' },
        });
        mockGetConfig.mockReturnValue({
          adminToolsEnabled: false,
          server: 'https://my-tableau-server.com',
        } as any);

        const scopes = await getSupportedApiScopes(clientId);
        expect(scopes.includes('tableau:packages:read')).toBe(expected);
      },
    );

    it('should require base publish scopes plus projects read, excluding optional permissions read', () => {
      const scopes = getRequiredApiScopesForTool('publish-workbook');

      expect(scopes).toEqual([
        'tableau:workbooks:create',
        'tableau:file_uploads:create',
        'tableau:projects:read',
      ]);
    });

    it('should require workbooks update, projects read, and resource access scopes for move-workbook', () => {
      expect(getRequiredApiScopesForTool('move-workbook')).toEqual([
        'tableau:workbooks:update',
        'tableau:projects:read',
        'tableau:content:read',
        'tableau:mcp_site_settings:read',
      ]);
    });

    it('should require all view-data API scopes for get-view-data', () => {
      expect(getRequiredApiScopesForTool('get-view-data')).toEqual([
        'tableau:views:download',
        'tableau:content:read',
        'tableau:mcp_site_settings:read',
      ]);
    });

    it('should include tableau:users:update when adminToolsEnabled and admin-tools are both on', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => featureName === 'admin-tools',
      );
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).toContain('tableau:users:update');
    });

    it('should exclude tableau:users:update when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).not.toContain('tableau:users:update');
    });

    it('should always include other API scopes regardless of adminToolsEnabled', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).toContain('tableau:content:read');
      expect(scopes).toContain('tableau:mcp_site_settings:read');
    });

    // Registration-condition probe scopes must be advertised too, or the token minted from this
    // metadata lacks them and the probe fails closed, hiding the very tools it gates. The Pulse
    // premium probe reads `tableau:entitlements:read`, which no tool declares in its own scope set.
    // They are advertised only when `enforce-registration-conditions` is on, since that flag is what
    // makes the probes actually run.
    it('should advertise tableau:entitlements:read for the RequiresPulsePremium probe when enforce-registration-conditions is enabled', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => featureName === 'enforce-registration-conditions',
      );
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).toContain('tableau:entitlements:read');
    });

    it('should NOT advertise condition probe scopes when enforce-registration-conditions is disabled', async () => {
      // Default mock: every feature (including enforce-registration-conditions) is off.
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes();
      // `tableau:entitlements:read` is only ever contributed by the RequiresPulsePremium condition,
      // so its absence proves condition scopes are not advertised when the flag is off.
      expect(scopes).not.toContain('tableau:entitlements:read');
    });

    it('should advertise the Knowledge availability probe scope when knowledge-tools and enforce-registration-conditions are enabled', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) =>
          featureName === 'knowledge-tools' || featureName === 'enforce-registration-conditions',
      );
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).toContain('tableau:knowledge:read');
    });
  });

  it('should separate Knowledge inspection and management API scopes', () => {
    expect(getRequiredApiScopesForTool('inspect-knowledge-context')).toEqual([
      'tableau:knowledge:read',
    ]);
    expect(getRequiredApiScopesForTool('manage-knowledge-context')).toEqual([
      'tableau:knowledge:write',
      'tableau:knowledge:read',
    ]);
  });

  describe('flowReadToolsEnabled gating', () => {
    it.each(
      [undefined, false, true].flatMap((readEnv) =>
        [false, true].map((readFlag) => ({ readEnv, readFlag })),
      ),
    )(
      'advertises matching scopes for read env=$readEnv, read FF=$readFlag',
      async ({ readEnv, readFlag }) => {
        mockGetConfig.mockReturnValue({
          adminToolsEnabled: false,
          flowReadToolsEnabled: readEnv,
        } as ReturnType<typeof configModule.getConfig>);
        mocks.mockIsFeatureEnabled.mockImplementation(
          async (featureName: string) =>
            (featureName === 'flow-read-tools' && readFlag) || featureName === 'flow-write-tools',
        );

        const mcp = await getSupportedMcpScopes();
        const api = await getSupportedApiScopes();
        const readEnabled = readEnv ?? readFlag;
        expect(mcp.includes('tableau:mcp:flow:read')).toBe(readEnabled);
        expect(api.includes('tableau:flows:download')).toBe(readEnabled);
        // Write tools do not depend on the read gate.
        expect(mcp.includes('tableau:mcp:flow:run')).toBe(true);
      },
    );
  });

  describe('flowWriteToolsEnabled gating', () => {
    it.each(
      [undefined, false, true].flatMap((writeEnv) =>
        [false, true].map((writeFlag) => ({ writeEnv, writeFlag })),
      ),
    )(
      'advertises matching scopes for write env=$writeEnv, write FF=$writeFlag',
      async ({ writeEnv, writeFlag }) => {
        mockGetConfig.mockReturnValue({
          adminToolsEnabled: false,
          flowWriteToolsEnabled: writeEnv,
        } as ReturnType<typeof configModule.getConfig>);
        mocks.mockIsFeatureEnabled.mockImplementation(
          async (featureName: string) =>
            featureName === 'flow-read-tools' || (featureName === 'flow-write-tools' && writeFlag),
        );

        const mcp = await getSupportedMcpScopes();
        const api = await getSupportedApiScopes();
        const writeEnabled = writeEnv ?? writeFlag;
        // Read tools do not depend on the write gate.
        expect(mcp.includes('tableau:mcp:flow:read')).toBe(true);
        for (const scope of ['tableau:mcp:flow:run', 'tableau:mcp:flow:cancel'] as const) {
          expect(mcp.includes(scope)).toBe(writeEnabled);
        }
        for (const scope of [
          'tableau:flows:run',
          'tableau:flow_tasks:run',
          'tableau:flow_runs:update',
        ] as const) {
          expect(api.includes(scope)).toBe(writeEnabled);
        }
      },
    );

    it('includes the flow run mcp + api scopes when the flow-write-tools flag is on and FLOW_WRITE_TOOLS_ENABLED is unset', async () => {
      mocks.mockIsFeatureEnabled.mockResolvedValue(true);
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const mcp = await getSupportedMcpScopes();
      expect(mcp).toContain('tableau:mcp:flow:run');
      expect(mcp).toContain('tableau:mcp:flow:cancel');

      const api = await getSupportedApiScopes();
      expect(api).toContain('tableau:flows:run');
      expect(api).toContain('tableau:flow_tasks:run');
      expect(api).toContain('tableau:flow_runs:update');
    });

    it('excludes flow run scopes when flowWriteToolsEnabled is false', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) =>
          featureName === 'flow-read-tools' || featureName === 'flow-write-tools',
      );
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
        flowWriteToolsEnabled: false,
      } as any);

      const mcp = await getSupportedMcpScopes();
      expect(mcp).not.toContain('tableau:mcp:flow:run');
      expect(mcp).not.toContain('tableau:mcp:flow:cancel');
      // The read flow scope is unaffected when the read tools remain enabled.
      expect(mcp).toContain('tableau:mcp:flow:read');

      const api = await getSupportedApiScopes();
      expect(api).not.toContain('tableau:flows:run');
      expect(api).not.toContain('tableau:flow_tasks:run');
      expect(api).not.toContain('tableau:flow_runs:update');
    });

    it('includes flow run scopes when flowWriteToolsEnabled is true and the flag is disabled', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
        flowWriteToolsEnabled: true,
      } as any);

      const mcp = await getSupportedMcpScopes();
      expect(mcp).toContain('tableau:mcp:flow:run');
      expect(mcp).toContain('tableau:mcp:flow:cancel');

      const api = await getSupportedApiScopes();
      expect(api).toContain('tableau:flows:run');
      expect(api).toContain('tableau:flow_tasks:run');
      expect(api).toContain('tableau:flow_runs:update');
    });

    it('treats the flow run scope as invalid when flowWriteToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
        flowWriteToolsEnabled: false,
      } as any);

      expect(await isValidScope('tableau:mcp:flow:run')).toBe(false);
      expect(await isValidScope('tableau:mcp:flow:cancel')).toBe(false);
    });
  });

  describe('getSupportedScopes', () => {
    it('should return only MCP scopes when includeApiScopes is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = await getSupportedScopes({ includeApiScopes: false });
      expect(scopes).toContain('tableau:mcp:datasource:read');
      expect(scopes).not.toContain('tableau:content:read');
    });

    it('should return both MCP and API scopes when includeApiScopes is true', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = await getSupportedScopes({ includeApiScopes: true });
      expect(scopes).toContain('tableau:mcp:datasource:read');
      expect(scopes).toContain('tableau:content:read');
    });

    it('should respect adminToolsEnabled flag when includeApiScopes is true', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedScopes({ includeApiScopes: true });
      expect(scopes).not.toContain('tableau:mcp:tasks:read');
      expect(scopes).not.toContain('tableau:mcp:tasks:write');
      expect(scopes).not.toContain('tableau:mcp:jobs:read');
      expect(scopes).not.toContain('tableau:tasks:read');
      expect(scopes).not.toContain('tableau:tasks:write');
      expect(scopes).not.toContain('tableau:jobs:read');
      expect(scopes).not.toContain('tableau:users:read');
      expect(scopes).not.toContain('tableau:mcp:users:write');
      expect(scopes).not.toContain('tableau:users:update');
    });
    // No clientId: the path /.well-known/oauth-protected-resource uses for scopes_supported.
    it('should advertise admin scopes when the admin-tools flag is on even if adminToolsEnabled is false', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => featureName === 'admin-tools',
      );
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedScopes({ includeApiScopes: true });
      expect(scopes).toContain('tableau:mcp:tasks:read');
      expect(scopes).toContain('tableau:mcp:tasks:write');
      expect(scopes).toContain('tableau:mcp:jobs:read');
      expect(scopes).toContain('tableau:mcp:users:write');
      expect(scopes).toContain('tableau:mcp:content:delete');
      expect(scopes).toContain('tableau:tasks:read');
      expect(scopes).toContain('tableau:users:update');
    });

    it('should always include the site-settings scope when MCP site settings are enabled, even without API scopes', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
        enableMcpSiteSettings: true,
      } as any);

      const scopes = await getSupportedScopes({ includeApiScopes: false });
      expect(scopes).toContain('tableau:mcp_site_settings:read');
      // Only the always-required scope is forced; other API scopes stay excluded.
      expect(scopes).not.toContain('tableau:content:read');
    });

    it('should not force the site-settings scope when MCP site settings are disabled', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
        enableMcpSiteSettings: false,
      } as any);

      const scopes = await getSupportedScopes({ includeApiScopes: false });
      expect(scopes).not.toContain('tableau:mcp_site_settings:read');
    });
  });

  describe('getAlwaysRequiredApiScopes', () => {
    it('should require the site-settings scope when MCP site settings are enabled', () => {
      mockGetConfig.mockReturnValue({ enableMcpSiteSettings: true } as any);
      expect(getAlwaysRequiredApiScopes()).toEqual(['tableau:mcp_site_settings:read']);
    });

    it('should require no scopes when MCP site settings are disabled', () => {
      mockGetConfig.mockReturnValue({ enableMcpSiteSettings: false } as any);
      expect(getAlwaysRequiredApiScopes()).toEqual([]);
    });
  });

  describe('isValidScope', () => {
    it('should return true for valid MCP scopes when adminToolsEnabled and admin-tools are both on', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => featureName === 'admin-tools',
      );
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      await expect(isValidScope('tableau:mcp:tasks:read')).resolves.toBe(true);
      await expect(isValidScope('tableau:mcp:tasks:write')).resolves.toBe(true);
      await expect(isValidScope('tableau:mcp:jobs:read')).resolves.toBe(true);
      await expect(isValidScope('tableau:mcp:datasource:read')).resolves.toBe(true);
    });

    it('should return true for admin MCP scopes when the admin-tools flag is on even if adminToolsEnabled is false', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => featureName === 'admin-tools',
      );
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      await expect(isValidScope('tableau:mcp:tasks:read')).resolves.toBe(true);
      await expect(isValidScope('tableau:mcp:content:delete')).resolves.toBe(true);
    });

    it('should return false for tableau:mcp:tasks:read when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      await expect(isValidScope('tableau:mcp:tasks:read')).resolves.toBe(false);
    });

    it('should return false for tableau:mcp:tasks:write when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      await expect(isValidScope('tableau:mcp:tasks:write')).resolves.toBe(false);
    });

    it('should return false for tableau:mcp:jobs:read when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      await expect(isValidScope('tableau:mcp:jobs:read')).resolves.toBe(false);
    });

    it('should return true for other valid MCP scopes when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      await expect(isValidScope('tableau:mcp:datasource:read')).resolves.toBe(true);
      await expect(isValidScope('tableau:mcp:workbook:read')).resolves.toBe(true);
    });

    it('should return true for tableau:mcp:workbook:create for ChatGPT', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      await expect(isValidScope('tableau:mcp:workbook:create', chatGptClientId)).resolves.toBe(
        true,
      );
    });

    it('should return true for tableau:mcp:workbook:create for a non-Slack client', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      await expect(isValidScope('tableau:mcp:workbook:create', claudeClientId)).resolves.toBe(true);
    });

    it('should return false for tableau:mcp:workbook:create for Slack', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      await expect(isValidScope('tableau:mcp:workbook:create', slackClientId)).resolves.toBe(false);
    });

    it('should return true for tableau:mcp:workbook:create for Slack when authoring-with-slack is enabled', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(async (featureName: string) => {
        return featureName === 'authoring-with-slack';
      });
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      await expect(isValidScope('tableau:mcp:workbook:create', slackClientId)).resolves.toBe(true);
    });

    it('should return false for tableau:mcp:workbook:write when data-apps is disabled', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      await expect(isValidScope('tableau:mcp:workbook:write', claudeClientId)).resolves.toBe(false);
    });

    it('should return true for tableau:mcp:workbook:write when data-apps is enabled', async () => {
      mocks.mockIsFeatureEnabled.mockImplementation(async (featureName: string) => {
        return featureName === 'data-apps';
      });
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      await expect(isValidScope('tableau:mcp:workbook:write', claudeClientId)).resolves.toBe(true);
    });

    it('should return false for invalid scopes', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      await expect(isValidScope('invalid:scope')).resolves.toBe(false);
      await expect(isValidScope('tableau:invalid:scope')).resolves.toBe(false);
    });
  });
});
