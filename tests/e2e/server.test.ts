import pkg from '../../package.json';
import { desktopToolNames } from '../../src/tools/desktop/toolName.js';
import { WebToolName, webToolNames } from '../../src/tools/web/toolName.js';
import { resetEnv, setEnv } from '../testEnv.js';
import { buildVariant } from './build.js';
import { McpClient } from './mcpClient.js';

const serverVersion = pkg.version;

describe('server', () => {
  beforeAll(setEnv);
  afterAll(resetEnv);

  describe('default variant', () => {
    let client: McpClient;

    beforeAll(async () => {
      await buildVariant('default');
      client = new McpClient({ variant: 'default' });
      await client.connect();
    });

    afterAll(async () => {
      await client.close();
    });

    it('should get server version', async () => {
      expect(await client.getServerVersion()).toEqual({
        name: 'tableau-mcp',
        version: serverVersion,
      });
    });

    it('should list tools', async () => {
      const names = await client.listTools();
      const oauthOnlyTools: ReadonlyArray<WebToolName> = ['revoke-access-token', 'reset-consent'];
      const adminOnlyTools: ReadonlyArray<WebToolName> = [
        'list-extract-refresh-tasks',
        'update-cloud-extract-refresh-task',
        'list-jobs',
        'list-users',
        'query-admin-insights',
        'delete-content',
      ];
      // These tools are gated by the mcp-apps feature (disabled by default in features.json):
      // get-embed-token, plus the app-only confirm-* tools.
      const mcpAppsTools: ReadonlyArray<WebToolName> = [
        'get-embed-token',
        'confirm-delete-content',
        'confirm-update-cloud-extract-refresh-task',
      ];
      // flow tools are gated off by default (FLOW_TOOLS_ENABLED)
      const flowTools: ReadonlyArray<WebToolName> = ['list-flows', 'get-flow'];
      // insights tools are gated off by default (INSIGHTS_TOOLS_ENABLED)
      const insightsTools: ReadonlyArray<WebToolName> = [
        'generate-insight-cards',
        'resolve-datasource-luid',
      ];

      let expectedToolNames = [...webToolNames];

      // Filter out oauth-only tools if not using oauth
      if (process.env.AUTH !== 'oauth') {
        expectedToolNames = expectedToolNames.filter((name) => !oauthOnlyTools.includes(name));
      }

      // Filter out admin-only tools if admin tools are not enabled
      if (process.env.ADMIN_TOOLS_ENABLED !== 'true') {
        expectedToolNames = expectedToolNames.filter((name) => !adminOnlyTools.includes(name));
      }

      // Filter out flow tools if they are not enabled
      if (process.env.FLOW_TOOLS_ENABLED !== 'true') {
        expectedToolNames = expectedToolNames.filter((name) => !flowTools.includes(name));
      }

      // Filter out insights tools if they are not enabled
      if (process.env.INSIGHTS_TOOLS_ENABLED !== 'true') {
        expectedToolNames = expectedToolNames.filter((name) => !insightsTools.includes(name));
      }

      // Filter out mcp-apps tools (mcp-apps is disabled by default in features.json)
      expectedToolNames = expectedToolNames.filter((name) => !mcpAppsTools.includes(name));

      expect(names).toEqual(expect.arrayContaining(expectedToolNames));
      expect(names).toHaveLength(expectedToolNames.length);
    });
  });

  describe('desktop variant', () => {
    let client: McpClient;

    beforeAll(async () => {
      await buildVariant('desktop');
      client = new McpClient({ variant: 'desktop' });
      await client.connect();
    });

    afterAll(async () => {
      await client.close();
    });

    it('should get server version', async () => {
      expect(await client.getServerVersion()).toEqual({
        name: 'tableau-desktop-mcp',
        version: serverVersion,
      });
    });

    it('should list tools', async () => {
      const names = await client.listTools();
      const expectedToolNames = [...desktopToolNames];
      expect(names).toEqual(expect.arrayContaining(expectedToolNames));
      expect(names).toHaveLength(expectedToolNames.length);
    });
  });

  describe('combined variant', () => {
    let client: McpClient;

    beforeAll(async () => {
      await buildVariant('combined');
      client = new McpClient({ variant: 'combined' });
      await client.connect();
    });

    afterAll(async () => {
      await client.close();
    });

    it('should get server version', async () => {
      expect(await client.getServerVersion()).toEqual({
        name: 'tableau-combined-mcp',
        version: serverVersion,
      });
    });

    it('should list tools', async () => {
      const names = await client.listTools();
      const oauthOnlyTools: ReadonlyArray<WebToolName> = ['revoke-access-token', 'reset-consent'];
      const adminOnlyTools: ReadonlyArray<WebToolName> = [
        'list-extract-refresh-tasks',
        'update-cloud-extract-refresh-task',
        'list-jobs',
        'list-users',
        'query-admin-insights',
        'delete-content',
      ];
      // These tools are gated by the mcp-apps feature (disabled by default in features.json):
      // get-embed-token, plus the app-only confirm-* tools.
      const mcpAppsTools: ReadonlyArray<WebToolName> = [
        'get-embed-token',
        'confirm-delete-content',
        'confirm-update-cloud-extract-refresh-task',
      ];
      // flow tools are gated off by default (FLOW_TOOLS_ENABLED)
      const flowTools: ReadonlyArray<WebToolName> = ['list-flows', 'get-flow'];
      // insights tools are gated off by default (INSIGHTS_TOOLS_ENABLED)
      const insightsTools: ReadonlyArray<WebToolName> = [
        'generate-insight-cards',
        'resolve-datasource-luid',
      ];

      let expectedWebToolNames = [...webToolNames];

      // Filter out oauth-only tools if not using oauth
      if (process.env.AUTH !== 'oauth') {
        expectedWebToolNames = expectedWebToolNames.filter(
          (name) => !oauthOnlyTools.includes(name),
        );
      }

      // Filter out admin-only tools if admin tools are not enabled
      if (process.env.ADMIN_TOOLS_ENABLED !== 'true') {
        expectedWebToolNames = expectedWebToolNames.filter(
          (name) => !adminOnlyTools.includes(name),
        );
      }

      // Filter out flow tools if they are not enabled
      if (process.env.FLOW_TOOLS_ENABLED !== 'true') {
        expectedWebToolNames = expectedWebToolNames.filter((name) => !flowTools.includes(name));
      }

      // Filter out insights tools if they are not enabled
      if (process.env.INSIGHTS_TOOLS_ENABLED !== 'true') {
        expectedWebToolNames = expectedWebToolNames.filter((name) => !insightsTools.includes(name));
      }

      // Filter out mcp-apps tools (mcp-apps is disabled by default in features.json)
      expectedWebToolNames = expectedWebToolNames.filter((name) => !mcpAppsTools.includes(name));

      const expectedToolNames = [...desktopToolNames, ...expectedWebToolNames];
      expect(names).toEqual(expect.arrayContaining(expectedToolNames));
      expect(names).toHaveLength(expectedToolNames.length);
    });
  });
});
