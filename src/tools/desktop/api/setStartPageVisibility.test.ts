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
import { getSetStartPageVisibilityTool } from './setStartPageVisibility.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const resultSchema = z.object({
  isStartPageVisible: z.boolean(),
  message: z.string(),
});

describe('setStartPageVisibilityTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('declares the required boolean, API floor, and idempotent mutation metadata', () => {
    const tool = getSetStartPageVisibilityTool(new DesktopMcpServer());
    const params = tool.paramsSchema as Record<string, z.ZodTypeAny>;

    expect(tool.name).toBe('set-start-page-visibility');
    expect(tool.minApiVersion).toBe('0.2.11');
    expect(params).toMatchObject({
      session: expect.any(Object),
      isStartPageVisible: expect.any(Object),
    });
    expect(params.session.safeParse(undefined).success).toBe(true);
    expect(params.isStartPageVisible.safeParse(undefined).success).toBe(false);
    expect(params.isStartPageVisible.safeParse(false).success).toBe(true);
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it.each([true, false])(
    'resolves the session and POSTs isStartPageVisible=%s exactly once',
    async (isStartPageVisible) => {
      const harness = await startHarness();
      try {
        const result = await harness.callTool({
          session: 'requested-session',
          isStartPageVisible,
        });

        expect(result.isError).toBe(false);
        expect(parseResult(result)).toEqual({
          isStartPageVisible,
          message: `The Tableau Desktop Start Page is ${isStartPageVisible ? 'visible' : 'hidden'}.`,
        });
        expect(sessionResolution.resolveSession).toHaveBeenCalledWith('requested-session');
        expect(harness.getExecutor).toHaveBeenCalledWith('999');

        const posted = harness.server.requests.filter(
          (request) => request.method === 'POST' && request.path === '/v0/app:toggleStartPage',
        );
        expect(posted).toHaveLength(1);
        expect(posted[0]).toMatchObject({
          authorization: 'Bearer valid-token',
          contentType: 'application/json',
        });
        expect(JSON.parse(posted[0].body)).toEqual({ isStartPageVisible });
      } finally {
        await harness.close();
      }
    },
  );

  it('reports Desktop returned visibility even when it differs from the request', async () => {
    const harness = await startHarness((server) => {
      server.setOverride('POST /v0/app:toggleStartPage', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ isStartPageVisible: false }),
      });
    });
    try {
      const result = await harness.callTool({ isStartPageVisible: true });

      expect(parseResult(result)).toEqual({
        isStartPageVisible: false,
        message: 'The Tableau Desktop Start Page is hidden.',
      });
    } finally {
      await harness.close();
    }
  });

  it('maps a missing route to endpoint-not-in-this-build', async () => {
    const harness = await startHarness((server) => {
      server.setOverride('POST /v0/app:toggleStartPage', {
        status: 404,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          code: 'not-found',
          status: 404,
          title: 'No route matches POST /v0/app:toggleStartPage',
          detail: 'No route matches POST /v0/app:toggleStartPage',
        }),
      });
    });
    try {
      const result = await harness.callTool({ isStartPageVisible: true });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(
        'does not serve the start-page visibility endpoint yet',
      );
      expect(result.content[0].text).toContain('Do not retry');
    } finally {
      await harness.close();
    }
  });

  it('surfaces an operation failure through the Desktop command error funnel', async () => {
    const harness = await startHarness((server) => {
      server.setOverride('POST /v0/app:toggleStartPage', {
        status: 500,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          code: 'operation-failed',
          status: 500,
          title: 'Start Page transition failed.',
          detail: 'Start Page transition failed.',
        }),
      });
    });
    try {
      const result = await harness.callTool({ isStartPageVisible: false });

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('operation-failed');
      expect(result.content[0].text).toContain('Start Page transition failed');
    } finally {
      await harness.close();
    }
  });
});

type Harness = {
  server: MockExternalApiServer;
  getExecutor: ReturnType<typeof vi.fn>;
  callTool: (args: { session?: string; isStartPageVisible: boolean }) => Promise<CallToolResult>;
  close: () => Promise<void>;
};

async function startHarness(
  configure?: (server: MockExternalApiServer) => void | Promise<void>,
): Promise<Harness> {
  const server = await startMockExternalApiServer();
  await configure?.(server);
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = getSetStartPageVisibilityTool(new DesktopMcpServer());
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
      await callback({ session: args.session, isStartPageVisible: args.isStartPageVisible }, extra),
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
    instanceId: 'inst-start-page',
    apiVersion: '0.2.11',
  };
}

function parseResult(result: CallToolResult): z.infer<typeof resultSchema> {
  invariant(result.content[0].type === 'text');
  return resultSchema.parse(JSON.parse(result.content[0].text));
}
