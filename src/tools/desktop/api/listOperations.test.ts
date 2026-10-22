import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { ExternalApiInstance, OperationList } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getListOperationsTool } from './listOperations.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const operationList: OperationList = {
  operations: [
    { id: 'op-1', kind: 'openFile', state: 'running' },
    {
      id: 'op-2',
      kind: 'saveWorkbook',
      state: 'failed',
      error: { code: 'save-failed', tableauErrorCode: 'TAB-42' },
    },
  ],
};

describe('list-operations tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('declares the read contract', () => {
    const tool = getListOperationsTool(new DesktopMcpServer());

    expect(tool.name).toBe('list-operations');
    expect(tool.description).toContain('tableauErrorCode');
    expect(tool.paramsSchema).toMatchObject({ session: expect.any(Object) });
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('returns the operations with state and error details', async () => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
    const harness = await startHarness();
    harness.server.setOverride('GET /v0/operations', {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(operationList),
    });

    try {
      const result = await harness.callTool({ session: undefined });

      expect(result.isError).toBe(false);
      expect(parseResult(result)).toEqual(operationList);
      expect(operationGets(harness.server)).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it('forwards an explicit session through canonical session resolution', async () => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('303'));
    const harness = await startHarness();

    try {
      const result = await harness.callTool({ session: '303' });

      expect(result.isError).toBe(false);
      expect(sessionResolution.resolveSession).toHaveBeenCalledWith('303');
      expect(harness.extra.getExecutor).toHaveBeenCalledWith('303');
    } finally {
      await harness.close();
    }
  });

  it('returns an error when the request fails', async () => {
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
    const harness = await startHarness();
    harness.server.setOverride('GET /v0/operations', {
      status: 500,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'problem',
        title: 'Internal error',
        status: 500,
        instance: '/v0/operations',
        code: 'internal-error',
        detail: 'Operation store unavailable',
      }),
    });

    try {
      const result = await harness.callTool({ session: undefined });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Operation store unavailable');
    } finally {
      await harness.close();
    }
  });

  it('validates the session param', async () => {
    const schema = z.object(
      await Provider.from(getListOperationsTool(new DesktopMcpServer()).paramsSchema),
    );

    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ session: '101' }).success).toBe(true);
    expect(schema.safeParse({ session: 101 }).success).toBe(false);
  });
});

function operationGets(server: MockExternalApiServer): MockExternalApiServer['requests'] {
  return server.requests.filter(
    (request) => request.method === 'GET' && request.path === '/v0/operations',
  );
}

function parseResult(result: CallToolResult): OperationList {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text) as OperationList;
}

async function startHarness(): Promise<{
  server: MockExternalApiServer;
  extra: ReturnType<typeof getMockRequestHandlerExtra>;
  callTool: (args: { session: string | undefined }) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer();
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = getListOperationsTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executor),
  };

  return {
    server,
    extra,
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
    instanceId: 'inst-list-operations',
    apiVersion: '0.2.25',
  };
}
