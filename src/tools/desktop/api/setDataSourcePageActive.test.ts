import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
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
import { getSetDataSourcePageActiveTool } from './setDataSourcePageActive.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const resultSchema = z.object({
  isDataSourcePageActive: z.boolean(),
  message: z.string(),
});

describe('setDataSourcePageActiveTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('declares the required boolean, API floor, and idempotent mutation metadata', () => {
    const tool = getSetDataSourcePageActiveTool(new DesktopMcpServer());
    const params = tool.paramsSchema as Record<string, z.ZodTypeAny>;

    expect(tool.name).toBe('set-data-source-page-active');
    expect(tool.minApiVersion).toBe('0.2.25');
    expect(params.session.safeParse(undefined).success).toBe(true);
    expect(params.isDataSourcePageActive.safeParse(undefined).success).toBe(false);
    expect(params.isDataSourcePageActive.safeParse('true').success).toBe(false);
    expect(params.isDataSourcePageActive.safeParse(false).success).toBe(true);
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it.each([true, false])(
    'POSTs isDataSourcePageActive=%s once and reports the state read back',
    async (isDataSourcePageActive) => {
      const harness = await startHarness();
      try {
        const result = await harness.callTool({
          session: 'requested-session',
          isDataSourcePageActive,
        });

        expect(result.isError).toBe(false);
        expect(parseResult(result)).toEqual({
          isDataSourcePageActive,
          message: `The Data Source page is ${isDataSourcePageActive ? 'active' : 'not active'}.`,
        });
        expect(sessionResolution.resolveSession).toHaveBeenCalledWith('requested-session');
        expect(harness.getExecutor).toHaveBeenCalledWith('999');

        const posted = harness.server.requests.filter(
          (request) => request.method === 'POST' && request.path === '/v0/app:toggleDataSourcePage',
        );
        expect(posted).toHaveLength(1);
        expect(JSON.parse(posted[0].body)).toEqual({ isDataSourcePageActive });
      } finally {
        await harness.close();
      }
    },
  );

  it('reports the actual state when Desktop leaves the page unchanged', async () => {
    const harness = await startHarness((server) => {
      server.setOverride('GET /v0/app', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ isDataSourcePageActive: false }),
      });
    });
    try {
      const result = await harness.callTool({ isDataSourcePageActive: true });

      expect(result.isError).toBe(false);
      expect(parseResult(result)).toEqual({
        isDataSourcePageActive: false,
        message: 'The Data Source page is not active.',
      });
    } finally {
      await harness.close();
    }
  });

  it('surfaces an operation failure through the Desktop command error funnel', async () => {
    const harness = await startHarness((server) => {
      server.setOverride('POST /v0/app:toggleDataSourcePage', {
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          code: 'operation-failed',
          status: 500,
          title: 'Data Source page switch failed.',
          detail: 'Data Source page switch failed.',
        }),
      });
    });
    try {
      const result = await harness.callTool({ isDataSourcePageActive: true });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('operation-failed');
      expect(result.content[0].text).toContain('Data Source page switch failed');
    } finally {
      await harness.close();
    }
  });
});

type Harness = {
  server: MockExternalApiServer;
  getExecutor: ReturnType<typeof vi.fn>;
  callTool: (args: {
    session?: string;
    isDataSourcePageActive: boolean;
  }) => Promise<CallToolResult>;
  close: () => Promise<void>;
};

async function startHarness(
  configure?: (server: MockExternalApiServer) => void | Promise<void>,
): Promise<Harness> {
  const server = await startMockExternalApiServer();
  await configure?.(server);
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = getSetDataSourcePageActiveTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const getExecutor = vi.fn().mockResolvedValue(executor);
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor,
  };

  return {
    server,
    getExecutor,
    callTool: async (args) =>
      await callback(
        { session: args.session, isDataSourcePageActive: args.isDataSourcePageActive },
        extra,
      ),
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
    instanceId: 'inst-data-source-page',
    apiVersion: '0.2.25',
  };
}

function parseResult(result: CallToolResult): z.infer<typeof resultSchema> {
  invariant(result.content[0].type === 'text');
  return resultSchema.parse(JSON.parse(result.content[0].text));
}
