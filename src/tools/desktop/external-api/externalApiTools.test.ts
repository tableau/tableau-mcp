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
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getDesktopReadTool } from './desktopRead.js';

vi.mock('../../../desktop/sessionResolution.js');

describe('desktop-read dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it.each([
    {
      method: 'health',
      args: {},
      expectedPath: '/v0/health',
      expectBody: (body: unknown) => {
        expect(z.object({ healthy: z.boolean() }).parse(body).healthy).toBe(true);
      },
    },
    {
      method: 'api-root',
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
      method: 'site',
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
      method: 'storyboards',
      args: {},
      expectedPath: '/v0/workbook/storyboards',
      expectBody: (body: unknown) => {
        const parsed = z.object({ storyboards: z.array(z.object({ id: z.string() })) }).parse(body);
        expect(parsed.storyboards[0].id).toBe('story-qbr');
      },
    },
    {
      method: 'site-workbooks',
      args: {},
      expectedPath: '/v0/site/workbooks',
      expectBody: (body: unknown) => {
        const parsed = z
          .object({ workbooks: z.array(z.object({ id: z.string(), luid: z.string().optional() })) })
          .parse(body);
        expect(parsed.workbooks[0].id).toBe('wb-regional-sales');
      },
    },
  ])(
    '$method returns the mock server payload',
    async ({ method, args, expectedPath, expectBody }) => {
      const harness = await startHarness();
      try {
        const result = await harness.callTool({ method, ...args });

        expect(result.isError).toBe(false);
        expectBody(parseResult(result));
        expect(harness.server.requests.at(-1)?.path).toBe(expectedPath);
      } finally {
        await harness.close();
      }
    },
  );

  it('gets worksheet metadata by id after resolving it through the worksheet list', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ method: 'worksheet-info', target: 'sheet-sales' });

      expect(result.isError).toBe(false);
      expect(
        z.object({ id: z.string(), name: z.string() }).parse(parseResult(result)),
      ).toMatchObject({
        id: 'sheet-sales',
        name: 'Sales by Region',
      });
      expect(harness.server.requests.map((request) => request.path)).toEqual([
        '/v0/workbook/worksheets',
        '/v0/workbook/worksheets/sheet-sales',
      ]);
    } finally {
      await harness.close();
    }
  });

  it('gets worksheet metadata by name after resolving it to an id', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({
        method: 'worksheet-info',
        target: 'Sales by Region',
      });

      expect(result.isError).toBe(false);
      expect(
        z.object({ id: z.string(), name: z.string() }).parse(parseResult(result)),
      ).toMatchObject({
        id: 'sheet-sales',
        name: 'Sales by Region',
      });
      expect(harness.server.requests.map((request) => request.path)).toEqual([
        '/v0/workbook/worksheets',
        '/v0/workbook/worksheets/sheet-sales',
      ]);
    } finally {
      await harness.close();
    }
  });

  it('reports available worksheets when the worksheet selector does not resolve', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ method: 'worksheet-info', target: 'Missing Sheet' });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Worksheet "Missing Sheet" was not found.');
      expect(result.content[0].text).toContain(
        'Available worksheets: Sales by Region (sheet-sales), Profit by Category (sheet-profit)',
      );
      expect(harness.server.requests.map((request) => request.path)).toEqual([
        '/v0/workbook/worksheets',
      ]);
    } finally {
      await harness.close();
    }
  });

  it('requires a target for an item-scoped read before hitting the server', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ method: 'worksheet-info' });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('requires a target');
      expect(harness.server.requests).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it('gets dashboard metadata by name after resolving it to an id', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({
        method: 'dashboard-info',
        target: 'Executive Dashboard',
      });

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
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ method: 'health', session: 'desktop-2' });

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toBe('{"healthy":true}');
      expect(sessionResolution.resolveSession).toHaveBeenCalledWith('desktop-2');
    } finally {
      await harness.close();
    }
  });

  it('resolves XML-escaped dashboard names', async () => {
    const harness = await startHarness((server) => {
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
      const result = await harness.callTool({
        method: 'dashboard-info',
        target: 'Sales &amp; Data',
      });

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
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ method: 'storyboard-info', target: 'QBR Story' });

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
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ method: 'storyboard-document', target: 'QBR Story' });

      expect(result.isError).toBe(false);
      expect(z.object({ xml: z.string() }).parse(parseResult(result)).xml).toContain(
        '<storyboard name="QBR Story"',
      );
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
      method: 'api-root',
      args: {},
      overrideKey: 'GET /v0/',
      expectedMessage: 'does not serve the API root endpoint',
    },
    {
      method: 'site',
      args: {},
      overrideKey: 'GET /v0/site',
      expectedMessage: 'does not serve the site endpoint',
    },
    {
      method: 'storyboards',
      args: {},
      overrideKey: 'GET /v0/workbook/storyboards',
      expectedMessage: 'does not serve the storyboard list endpoint',
    },
    {
      method: 'dashboard-info',
      args: { target: 'dash-exec' },
      overrideKey: 'GET /v0/workbook/dashboards/dash-exec',
      expectedMessage: 'does not serve the dashboard metadata endpoint',
    },
    {
      method: 'storyboard-info',
      args: { target: 'story-qbr' },
      overrideKey: 'GET /v0/workbook/storyboards/story-qbr',
      expectedMessage: 'does not serve the storyboard metadata endpoint',
    },
    {
      method: 'storyboard-document',
      args: { target: 'story-qbr' },
      overrideKey: 'GET /v0/workbook/storyboards/story-qbr/document',
      expectedMessage: 'does not serve the storyboard document endpoint',
    },
  ])(
    '$method reports an honest too-new endpoint 404',
    async ({ method, args, overrideKey, expectedMessage }) => {
      const harness = await startHarness((server) => {
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
        const result = await harness.callTool({ method, ...args });

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

async function startHarness(configure?: (server: MockExternalApiServer) => void): Promise<{
  server: MockExternalApiServer;
  callTool: (args: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer();
  configure?.(server);
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = getDesktopReadTool(new DesktopMcpServer());
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
