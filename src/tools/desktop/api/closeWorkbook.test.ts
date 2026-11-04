import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { withApplyLock } from '../../../desktop/wrappers/applyMutex.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getCloseWorkbookTool } from './closeWorkbook.js';

vi.mock('../../../desktop/session/sessionResolution.js');

describe('close-workbook tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('declares a 0.2.32 destructive tool', () => {
    const tool = getCloseWorkbookTool(new DesktopMcpServer());
    expect(tool.minApiVersion).toBe('0.2.32');
    expect(tool.annotations?.destructiveHint).toBe(true);
  });

  it('POSTs /v0/workbook:close with no body and reports success', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({});
      expect(result.isError).toBeFalsy();
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Closed the open workbook');

      const posted = harness.server.requests.filter(
        (r) => r.method === 'POST' && r.path === '/v0/workbook:close',
      );
      expect(posted).toHaveLength(1);
      expect(posted[0].body).toBe('');
    } finally {
      await harness.close();
    }
  });

  it('waits for an in-flight apply before closing', async () => {
    let releaseLock!: () => void;
    const lockReleased = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let markLockHeld!: () => void;
    const lockHeld = new Promise<void>((resolve) => {
      markLockHeld = resolve;
    });
    const blocker = withApplyLock(async () => {
      markLockHeld();
      await lockReleased;
    });
    await lockHeld;

    const closeWorkbook = vi.fn(
      async () => new Ok({ command_id: 'close', status: 'completed' as const, result: null }),
    );
    const executor = { closeWorkbook } as unknown as ExternalApiToolExecutor;
    const tool = getCloseWorkbookTool(new DesktopMcpServer());
    const callback = (await Provider.from(tool.callback)) as (
      args: Record<string, unknown>,
      extra: ReturnType<typeof getMockRequestHandlerExtra>,
    ) => Promise<CallToolResult>;
    const extra = {
      ...getMockRequestHandlerExtra(),
      getExecutor: vi.fn().mockResolvedValue(executor),
    };

    const pending = callback({}, extra);
    try {
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(closeWorkbook).not.toHaveBeenCalled();

      releaseLock();
      await blocker;
      const result = await pending;
      expect(result.isError).toBeFalsy();
      expect(closeWorkbook).toHaveBeenCalledTimes(1);
    } finally {
      releaseLock();
      await blocker;
      await pending.catch(() => undefined);
    }
  });
});

type Harness = {
  server: MockExternalApiServer;
  callTool: (args: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
};

async function startHarness(): Promise<Harness> {
  const server = await startMockExternalApiServer();
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = getCloseWorkbookTool(new DesktopMcpServer());
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
    instanceId: 'inst-close',
    apiVersion: '0.2.32',
  };
}
