import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

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
import { DesktopTool } from '../tool.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getAddDashboardTool } from './addDashboard.js';
import { getAddStoryboardTool } from './addStoryboard.js';
import { getAddWorksheetTool } from './addWorksheet.js';

vi.mock('../../../desktop/session/sessionResolution.js');

describe('add-worksheet / add-dashboard / add-storyboard tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it.each([
    { makeTool: getAddWorksheetTool, path: '/v0/workbook/worksheets:new', message: 'worksheet' },
    { makeTool: getAddDashboardTool, path: '/v0/workbook/dashboards:new', message: 'dashboard' },
    { makeTool: getAddStoryboardTool, path: '/v0/workbook/storyboards:new', message: 'storyboard' },
  ])('$path (no index) appends a blank $message', async ({ makeTool, path, message }) => {
    const harness = await startHarness(makeTool);
    try {
      const result = await harness.callTool({});
      expect(result.isError).toBeFalsy();
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(`Added a blank ${message}.`);

      const posted = harness.server.requests.filter((r) => r.method === 'POST' && r.path === path);
      expect(posted).toHaveLength(1);
      // A bare append carries neither a body nor an index query.
      expect(posted[0].body).toBe('');
      expect(posted[0].searchParams).toEqual({});
    } finally {
      await harness.close();
    }
  });

  it.each([
    { makeTool: getAddWorksheetTool, path: '/v0/workbook/worksheets:new' },
    { makeTool: getAddDashboardTool, path: '/v0/workbook/dashboards:new' },
    { makeTool: getAddStoryboardTool, path: '/v0/workbook/storyboards:new' },
  ])('$path pins the new tab position with the index query', async ({ makeTool, path }) => {
    const harness = await startHarness(makeTool);
    try {
      const result = await harness.callTool({ index: 2 });
      expect(result.isError).toBeFalsy();

      const posted = harness.server.requests.filter((r) => r.method === 'POST' && r.path === path);
      expect(posted).toHaveLength(1);
      expect(posted[0].searchParams).toEqual({ index: '2' });
    } finally {
      await harness.close();
    }
  });
});

async function startHarness(makeTool: (server: DesktopMcpServer) => DesktopTool<any>): Promise<{
  server: MockExternalApiServer;
  callTool: (args: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer();
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
    instanceId: 'inst-add-sheets',
    apiVersion: '1.0',
  };
}
