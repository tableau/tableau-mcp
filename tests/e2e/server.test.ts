import features from '../../features.json';
import pkg from '../../package.json';
import { desktopToolNames } from '../../src/tools/desktop/toolName.js';
import { WebToolName, webToolNames } from '../../src/tools/web/toolName.js';
import { getDefaultEnv, resetEnv, setEnv } from '../testEnv.js';
import { buildVariant } from './build.js';
import { McpClient } from './mcpClient.js';

const serverVersion = pkg.version;
const authoringToolsEnabled = Boolean(features['authoring-tools']);

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
      expect(await client.getServerVersion()).toMatchObject({
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
        'update-user',
        'query-admin-insights',
        'delete-content',
      ];
      // These tools are gated by the mcp-apps feature (disabled by default in features.json):
      // get-embed-token and render-interactive-viz, plus the app-only record-event and confirm-* tools.
      const mcpAppsTools: ReadonlyArray<WebToolName> = [
        'get-embed-token',
        'render-interactive-viz',
        'record-event',
        'confirm-delete-content',
        'confirm-update-cloud-extract-refresh-task',
      ];
      // flow tools are gated off by default (FLOW_TOOLS_ENABLED)
      const flowTools: ReadonlyArray<WebToolName> = [
        'list-flows',
        'get-flow',
        'list-flow-runs',
        'list-flow-tasks',
      ];
      // insights tools are gated off by default (INSIGHTS_TOOLS_ENABLED)
      const insightsTools: ReadonlyArray<WebToolName> = ['generate-insight-cards'];
      // authoring tools are gated off by default (authoring-tools feature flag)
      const authoringTools: ReadonlyArray<WebToolName> = [
        'request-workbook-upload',
        'publish-workbook',
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

      if (!features['authoring-tools']) {
        expectedToolNames = expectedToolNames.filter((name) => !authoringTools.includes(name));
      }

      // Filter out mcp-apps tools (mcp-apps is disabled by default in features.json)
      expectedToolNames = expectedToolNames.filter((name) => !mcpAppsTools.includes(name));
      if (!authoringToolsEnabled) {
        expectedToolNames = expectedToolNames.filter((name) => name !== 'download-workbook');
      }

      expect(names).toEqual(expect.arrayContaining(expectedToolNames));
      expect(names).toHaveLength(expectedToolNames.length);
    });

    // The default client spawns with getDefaultEnv(), which intentionally omits ADMIN_TOOLS_ENABLED,
    // so the server advertises only the base instructions and no admin guidance. The substrings here
    // are kept in lockstep with the unit test in src/server.web.test.ts.
    it('should carry base instructions without admin guidance when admin tools are disabled', async () => {
      const instructions = await client.getInstructions();
      expect(instructions).toBeTruthy();
      expect(instructions).toContain('Tableau MCP exposes tools');
      expect(instructions).not.toContain('site-administration capabilities');
      expect(instructions).not.toContain('general admin/site-health');
      expect(instructions).not.toContain('user-license reclamation');
      expect(instructions).not.toContain('query-admin-insights');
    });
  });

  // Instructions depend on ADMIN_TOOLS_ENABLED, which is fixed at process spawn, so the admin-on case
  // needs its own client with the flag injected into its env (mirroring how admin-tool tests inject it).
  describe('default variant with admin tools enabled', () => {
    let client: McpClient;

    beforeAll(async () => {
      await buildVariant('default');
      client = new McpClient({
        variant: 'default',
        env: { ...getDefaultEnv(), ADMIN_TOOLS_ENABLED: 'true' },
      });
      await client.connect();
    });

    afterAll(async () => {
      await client.close();
    });

    // The substrings here are kept in lockstep with the unit test in src/server.web.test.ts.
    it('should append admin site-health guidance to instructions when admin tools are enabled', async () => {
      const instructions = await client.getInstructions();
      expect(instructions).toBeTruthy();
      // Base guidance is still present...
      expect(instructions).toContain('Tableau MCP exposes tools');
      // ...and the admin capability menu + generic-intent tie-in is appended.
      expect(instructions).toContain('site-administration capabilities');
      expect(instructions).toContain('general admin/site-health');
      expect(instructions).toContain('user-license reclamation');
      expect(instructions).toContain('query-admin-insights');
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
      expect(await client.getServerVersion()).toMatchObject({
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
      expect(await client.getServerVersion()).toMatchObject({
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
        'update-user',
        'query-admin-insights',
        'delete-content',
      ];
      // These tools are gated by the mcp-apps feature (disabled by default in features.json):
      // get-embed-token and render-interactive-viz, plus the app-only record-event and confirm-* tools.
      const mcpAppsTools: ReadonlyArray<WebToolName> = [
        'get-embed-token',
        'render-interactive-viz',
        'record-event',
        'confirm-delete-content',
        'confirm-update-cloud-extract-refresh-task',
      ];
      // flow tools are gated off by default (FLOW_TOOLS_ENABLED)
      const flowTools: ReadonlyArray<WebToolName> = [
        'list-flows',
        'get-flow',
        'list-flow-runs',
        'list-flow-tasks',
      ];
      // insights tools are gated off by default (INSIGHTS_TOOLS_ENABLED)
      const insightsTools: ReadonlyArray<WebToolName> = ['generate-insight-cards'];
      // authoring tools are gated off by default (authoring-tools feature flag)
      const authoringTools: ReadonlyArray<WebToolName> = [
        'request-workbook-upload',
        'publish-workbook',
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

      if (!features['authoring-tools']) {
        expectedWebToolNames = expectedWebToolNames.filter(
          (name) => !authoringTools.includes(name),
        );
      }

      // Filter out mcp-apps tools (mcp-apps is disabled by default in features.json)
      expectedWebToolNames = expectedWebToolNames.filter((name) => !mcpAppsTools.includes(name));
      if (!authoringToolsEnabled) {
        expectedWebToolNames = expectedWebToolNames.filter((name) => name !== 'download-workbook');
      }

      const expectedToolNames = [...desktopToolNames, ...expectedWebToolNames];
      expect(names).toEqual(expect.arrayContaining(expectedToolNames));
      expect(names).toHaveLength(expectedToolNames.length);
    });

    // The combined bundle supplies its own McpServer to WebMcpServer, so instructions can only reach
    // the handshake if index.combined.ts constructs that McpServer with buildWebInstructions(). This
    // asserts the web guidance actually survives that provided-mcpServer path (it FAILS against
    // pre-fix combined code, where the composed instructions were silently dropped). The default
    // client spawns with getDefaultEnv(), which omits ADMIN_TOOLS_ENABLED, so only base guidance is
    // advertised and no admin guidance. Substrings kept in lockstep with the unit test in
    // src/server.web.test.ts.
    it('should carry base web instructions without admin guidance when admin tools are disabled', async () => {
      const instructions = await client.getInstructions();
      expect(instructions).toBeTruthy();
      expect(instructions).toContain('Tableau MCP exposes tools');
      expect(instructions).not.toContain('site-administration capabilities');
      expect(instructions).not.toContain('general admin/site-health');
      expect(instructions).not.toContain('user-license reclamation');
      expect(instructions).not.toContain('query-admin-insights');
    });
  });
});
