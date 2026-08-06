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
import { getRedoWorkbookTool } from './redoWorkbook.js';
import { getUndoWorkbookTool } from './undoWorkbook.js';

vi.mock('../../../desktop/session/sessionResolution.js');

describe('undo-workbook / redo-workbook tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it.each([
    { makeTool: getUndoWorkbookTool, path: '/v0/workbook:undo', message: 'Undid the last change' },
    { makeTool: getRedoWorkbookTool, path: '/v0/workbook:redo', message: 'Reapplied' },
  ])('POSTs $path and reports success', async ({ makeTool, path, message }) => {
    const harness = await startHarness(makeTool);
    try {
      const result = await harness.callTool({});
      expect(result.isError).toBeFalsy();
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(message);

      const posted = harness.server.requests.filter((r) => r.method === 'POST' && r.path === path);
      expect(posted).toHaveLength(1);
      // undo/redo carry no request body.
      expect(posted[0].body).toBe('');
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
    instanceId: 'inst-undo-redo',
    apiVersion: '1.0',
  };
}
