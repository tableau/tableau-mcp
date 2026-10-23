import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getReloadExtensionsTool } from './reloadExtensions.js';

vi.mock('../../../desktop/session/sessionResolution.js');

// Seeded by mockExternalApiServer.
const WORKSHEET_ID = 'sheet-sales';
const WORKSHEET_NAME = 'Sales by Region';
const DASHBOARD_ID = 'dash-exec';
const DASHBOARD_NAME = 'Executive Dashboard';
const STORYBOARD_NAME = 'QBR Story';

describe('reload-extensions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('declares its api floor and annotations', () => {
    const tool = getReloadExtensionsTool(new DesktopMcpServer());
    expect(tool.minApiVersion).toBe('0.2.25');
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it('POSTs the worksheet :reloadExtension route body-less', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ sheet: WORKSHEET_NAME });
      expect(result.isError).toBeFalsy();
      const posted = harness.server.requests.filter(
        (r) =>
          r.method === 'POST' &&
          r.path === `/v0/workbook/worksheets/${WORKSHEET_ID}:reloadExtension`,
      );
      expect(posted).toHaveLength(1);
      expect(posted[0].body).toBe('');
      invariant(result.content[0].type === 'text');
      expect(JSON.parse(result.content[0].text).message).toBe(
        `Requested reload of extensions for worksheet "${WORKSHEET_NAME}".`,
      );
    } finally {
      await harness.close();
    }
  });

  it('routes a dashboard target to the :reloadExtensions route', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ sheet: DASHBOARD_ID });
      expect(result.isError).toBeFalsy();
      const posted = harness.server.requests.filter(
        (r) =>
          r.method === 'POST' &&
          r.path === `/v0/workbook/dashboards/${DASHBOARD_ID}:reloadExtensions`,
      );
      expect(posted).toHaveLength(1);
      invariant(result.content[0].type === 'text');
      expect(JSON.parse(result.content[0].text).sheet).toEqual({
        id: DASHBOARD_ID,
        kind: 'dashboard',
        name: DASHBOARD_NAME,
      });
    } finally {
      await harness.close();
    }
  });

  it('rejects a storyboard target without dispatching', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ sheet: STORYBOARD_NAME });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('storyboard');
      expect(harness.server.requests.filter((r) => /reloadExtension/.test(r.path))).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it('rejects an unknown sheet without dispatching', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ sheet: 'No Such Sheet' });
      expect(result.isError).toBe(true);
      expect(harness.server.requests.filter((r) => /reloadExtension/.test(r.path))).toHaveLength(0);
    } finally {
      await harness.close();
    }
  });

  it('rejects a missing sheet param', async () => {
    const tool = getReloadExtensionsTool(new DesktopMcpServer());
    const schema = z.object(await Provider.from(tool.paramsSchema));
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ sheet: WORKSHEET_NAME }).success).toBe(true);
  });

  it('surfaces an executor failure as an error result', async () => {
    const harness = await startHarness();
    try {
      vi.spyOn(harness.executor, 'reloadWorksheetExtension').mockResolvedValue(
        Err({
          type: 'command-failed',
          error: { code: 'sheet-not-found', message: 'Sheet vanished.', recoverable: false },
        }),
      );
      const result = await harness.callTool({ sheet: WORKSHEET_NAME });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Sheet vanished.');
    } finally {
      await harness.close();
    }
  });
});

type Harness = {
  server: MockExternalApiServer;
  executor: ExternalApiToolExecutor;
  callTool: (args: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
};

async function startHarness(): Promise<Harness> {
  const server = await startMockExternalApiServer();
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = getReloadExtensionsTool(new DesktopMcpServer());
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
    executor,
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
    instanceId: 'inst-reload-extensions',
    apiVersion: '0.2.25',
  };
}
