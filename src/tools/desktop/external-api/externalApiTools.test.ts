import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { DesktopTool } from '../tool.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getApiRootTool } from './getApiRoot.js';
import { getDashboardInfoTool } from './getDashboardInfo.js';
import { getHealthTool } from './getHealth.js';
import { getSiteInfoTool } from './getSiteInfo.js';
import { getStoryboardInfoTool } from './getStoryboardInfo.js';
import { getStoryboardXmlTool } from './getStoryboardXml.js';
import { getWorksheetInfoTool } from './getWorksheetInfo.js';
import { getListStoryboardsTool } from './listStoryboards.js';

vi.mock('../../../desktop/sessionResolution.js');

describe('External API coverage tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it.each([
    {
      toolName: 'get-health',
      makeTool: getHealthTool,
      args: {},
      expectedPath: '/v0/health',
      expectBody: (body: unknown) => {
        expect(z.object({ healthy: z.boolean() }).parse(body).healthy).toBe(true);
      },
    },
    {
      toolName: 'get-api-root',
      makeTool: getApiRootTool,
      args: {},
      expectedPath: '/v0/',
      expectBody: (body: unknown) => {
        expect(
          z
            .object({
              apiVersion: z.string(),
              applicationVersion: z.string(),
              links: z.record(z.string()),
            })
            .parse(body),
        ).toMatchObject({ apiVersion: '0.1.0', links: { workbook: '/v0/workbook' } });
      },
    },
    {
      toolName: 'get-site-info',
      makeTool: getSiteInfoTool,
      args: {},
      expectedPath: '/v0/site',
      expectBody: (body: unknown) => {
        expect(
          z.object({ siteId: z.string(), authenticatedUserId: z.string() }).parse(body),
        ).toEqual({
          siteId: 'site-sales',
          authenticatedUserId: 'user-author',
        });
      },
    },
    {
      toolName: 'get-worksheet-info',
      makeTool: getWorksheetInfoTool,
      args: { worksheetId: 'sheet-sales' },
      expectedPath: '/v0/workbook/worksheets/sheet-sales',
      expectBody: (body: unknown) => {
        expect(z.object({ id: z.string(), name: z.string() }).parse(body)).toMatchObject({
          id: 'sheet-sales',
          name: 'Sales by Region',
        });
      },
    },
    {
      toolName: 'list-storyboards',
      makeTool: getListStoryboardsTool,
      args: {},
      expectedPath: '/v0/workbook/storyboards',
      expectBody: (body: unknown) => {
        const parsed = z.object({ storyboards: z.array(z.object({ id: z.string() })) }).parse(body);
        expect(parsed.storyboards[0].id).toBe('story-qbr');
      },
    },
  ])(
    '$toolName returns the mock server payload',
    async ({ makeTool, args, expectedPath, expectBody }) => {
      const harness = await startHarness(makeTool);
      try {
        const result = await harness.callTool(args);

        expect(result.isError).toBe(false);
        expectBody(parseResult(result));
        expect(harness.server.requests.at(-1)?.path).toBe(expectedPath);
      } finally {
        await harness.close();
      }
    },
  );

  it('gets dashboard metadata by name after resolving it to an id', async () => {
    const harness = await startHarness(getDashboardInfoTool);
    try {
      const result = await harness.callTool({ dashboard: 'Executive Dashboard' });

      expect(result.isError).toBe(false);
      expect(
        z
          .object({ id: z.string(), name: z.string(), containedSheets: z.array(z.string()) })
          .parse(parseResult(result)),
      ).toMatchObject({ id: 'dash-exec', name: 'Executive Dashboard' });
      expect(harness.server.requests.map((request) => request.path)).toEqual([
        '/v0/workbook/dashboards',
        '/v0/workbook/dashboards/dash-exec',
      ]);
    } finally {
      await harness.close();
    }
  });

  it('passes an explicit session to the session resolver', async () => {
    const harness = await startHarness(getHealthTool);
    try {
      const result = await harness.callTool({ session: 'desktop-2' });

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toBe('{"healthy":true}');
      expect(sessionResolution.resolveSession).toHaveBeenCalledWith('desktop-2');
    } finally {
      await harness.close();
    }
  });

  it('resolves XML-escaped dashboard names', async () => {
    const harness = await startHarness(getDashboardInfoTool, (server) => {
      server.setOverride('GET /v0/workbook/dashboards', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          dashboards: [{ id: 'dash-amp', name: 'Sales & Data', hidden: false }],
        }),
      });
      server.setOverride('GET /v0/workbook/dashboards/dash-amp', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'dash-amp', name: 'Sales & Data', hidden: false }),
      });
    });
    try {
      const result = await harness.callTool({ dashboard: 'Sales &amp; Data' });

      expect(result.isError).toBe(false);
      expect(z.object({ id: z.string() }).parse(parseResult(result)).id).toBe('dash-amp');
      expect(harness.server.requests.map((request) => request.path)).toEqual([
        '/v0/workbook/dashboards',
        '/v0/workbook/dashboards/dash-amp',
      ]);
    } finally {
      await harness.close();
    }
  });

  it('gets storyboard metadata by name after resolving it to an id', async () => {
    const harness = await startHarness(getStoryboardInfoTool);
    try {
      const result = await harness.callTool({ storyboard: 'QBR Story' });

      expect(result.isError).toBe(false);
      expect(
        z.object({ id: z.string(), name: z.string() }).parse(parseResult(result)),
      ).toMatchObject({
        id: 'story-qbr',
        name: 'QBR Story',
      });
      expect(harness.server.requests.map((request) => request.path)).toEqual([
        '/v0/workbook/storyboards',
        '/v0/workbook/storyboards/story-qbr',
      ]);
    } finally {
      await harness.close();
    }
  });

  it('gets a storyboard document by name after resolving it to an id', async () => {
    const harness = await startHarness(getStoryboardXmlTool);
    try {
      const result = await harness.callTool({ storyboard: 'QBR Story' });

      expect(result.isError).toBe(false);
      expect(
        z.object({ storyboardXml: z.string() }).parse(parseResult(result)).storyboardXml,
      ).toContain('<storyboard name="QBR Story"');
      expect(harness.server.requests.map((request) => request.path)).toEqual([
        '/v0/workbook/storyboards',
        '/v0/workbook/storyboards/story-qbr/document',
      ]);
    } finally {
      await harness.close();
    }
  });

  it.each([
    {
      toolName: 'get-api-root',
      makeTool: getApiRootTool,
      args: {},
      overrideKey: 'GET /v0/',
      expectedMessage: 'does not serve the API root endpoint',
    },
    {
      toolName: 'get-site-info',
      makeTool: getSiteInfoTool,
      args: {},
      overrideKey: 'GET /v0/site',
      expectedMessage: 'does not serve the site endpoint',
    },
    {
      toolName: 'list-storyboards',
      makeTool: getListStoryboardsTool,
      args: {},
      overrideKey: 'GET /v0/workbook/storyboards',
      expectedMessage: 'does not serve the storyboard list endpoint',
    },
    {
      toolName: 'get-dashboard-info',
      makeTool: getDashboardInfoTool,
      args: { dashboard: 'dash-exec' },
      overrideKey: 'GET /v0/workbook/dashboards/dash-exec',
      expectedMessage: 'does not serve the dashboard metadata endpoint',
    },
    {
      toolName: 'get-storyboard-info',
      makeTool: getStoryboardInfoTool,
      args: { storyboard: 'story-qbr' },
      overrideKey: 'GET /v0/workbook/storyboards/story-qbr',
      expectedMessage: 'does not serve the storyboard metadata endpoint',
    },
    {
      toolName: 'get-storyboard-xml',
      makeTool: getStoryboardXmlTool,
      args: { storyboard: 'story-qbr' },
      overrideKey: 'GET /v0/workbook/storyboards/story-qbr/document',
      expectedMessage: 'does not serve the storyboard document endpoint',
    },
  ])(
    '$toolName reports an honest too-new endpoint 404',
    async ({ makeTool, args, overrideKey, expectedMessage }) => {
      const harness = await startHarness(makeTool, (server) => {
        server.setOverride(overrideKey, {
          status: 404,
          body: JSON.stringify({
            code: 'not-found',
            status: 404,
            instance: '/v0/mock',
            title: `No route matches ${overrideKey}`,
            detail: `No route matches ${overrideKey}`,
          }),
        });
      });
      try {
        const result = await harness.callTool(args);

        expect(result.isError).toBe(true);
        invariant(result.content[0].type === 'text');
        expect(result.content[0].text).toContain(expectedMessage);
        expect(result.content[0].text).toContain('Do not retry');
      } finally {
        await harness.close();
      }
    },
  );
});

async function startHarness(
  makeTool: (server: DesktopMcpServer) => DesktopTool<any>,
  configure?: (server: MockExternalApiServer) => void,
): Promise<{
  server: MockExternalApiServer;
  callTool: (args: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer();
  configure?.(server);
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = makeTool(new DesktopMcpServer());
  const callback = (await Provider.from(tool.callback)) as (
    args: Record<string, unknown>,
    extra: ReturnType<typeof getMockRequestHandlerExtra>,
  ) => Promise<CallToolResult>;
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };

  return {
    server,
    callTool: async (args) => await callback(args, extra),
    close: async () => {
      executor.stop();
      await server.close();
    },
  };
}

function instanceFor(server: MockExternalApiServer): ExternalApiInstance {
  return {
    baseUrl: server.baseUrl,
    token: 'valid-token',
    pid: 999,
    instanceId: 'inst-external-api-tools',
    apiVersion: '1.0',
  };
}

function parseResult(result: CallToolResult): unknown {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}
