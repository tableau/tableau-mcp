import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { ExternalApiInstance, OperationEnvelope } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getOperationTool } from './getOperation.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const runningOperation = {
  id: 'op-1',
  kind: 'workbook.document.apply',
  state: 'RUNNING',
  blockingWindows: [],
  progressWindows: [],
};

describe('get-operation tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('declares the read contract', () => {
    const tool = getOperationTool(new DesktopMcpServer());

    expect(tool.name).toBe('get-operation');
    expect(tool.description).toContain('progressWindows');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      operationId: expect.any(Object),
    });
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('requires a non-empty operation id', () => {
    const schema = z.object(getOperationTool(new DesktopMcpServer()).paramsSchema as z.ZodRawShape);

    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ operationId: '' }).success).toBe(false);
    expect(schema.safeParse({ operationId: 'op-1' }).success).toBe(true);
  });

  it('returns the operation envelope for the requested id', async () => {
    const harness = await startHarness();
    harness.server.setOperation('op-1', { poll: [runningOperation] });

    try {
      const result = await harness.callTool({ session: undefined, operationId: 'op-1' });

      expect(result.isError).toBe(false);
      expect(parseResult(result)).toEqual(runningOperation);
      expect(harness.server.requests.map((request) => request.path)).toContain(
        '/v0/operations/op-1',
      );
    } finally {
      await harness.close();
    }
  });

  it('returns an error for an unknown operation id', async () => {
    const harness = await startHarness();

    try {
      const result = await harness.callTool({ session: undefined, operationId: 'op-missing' });

      expect(result.isError).toBe(true);
    } finally {
      await harness.close();
    }
  });
});

function parseResult(result: CallToolResult): OperationEnvelope {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text) as OperationEnvelope;
}

async function startHarness(): Promise<{
  server: MockExternalApiServer;
  callTool: (args: { session: string | undefined; operationId: string }) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer();
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = getOperationTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
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
    instanceId: 'inst-get-operation',
    apiVersion: '0.2.25',
  };
}
