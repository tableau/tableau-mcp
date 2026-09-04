import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import {
  MockExternalApiServer,
  MockOverride,
  startMockExternalApiServer,
} from '../../../desktop/externalApi/mockExternalApiServer.js';
import { ExternalApiInstance } from '../../../desktop/externalApi/types.js';
import * as sessionResolution from '../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getStartPerformanceRecordingTool } from './startPerformanceRecording.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const START_PATH = '/v0/workbook:startPerformanceRecording';

describe('start-performance-recording tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('declares the 0.2.11 floor and recorder side-effect metadata', () => {
    const tool = getStartPerformanceRecordingTool(new DesktopMcpServer());

    expect(tool.minApiVersion).toBe('0.2.11');
    expect(tool.paramsSchema).toMatchObject({ session: expect.any(Object) });
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('uses the explicit session and permits repeat bodyless starts', async () => {
    const harness = await startHarness();
    try {
      const first = await harness.callTool({ session: '999' });
      const second = await harness.callTool({ session: '999' });

      expect(first.isError).toBeFalsy();
      expect(second.isError).toBeFalsy();
      expect(textOf(first)).toContain('Started workbook performance recording');
      expect(sessionResolution.resolveSession).toHaveBeenCalledWith('999');
      expect(startPosts(harness.server)).toHaveLength(2);
      expect(startPosts(harness.server).every((request) => request.body === '')).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it('does not claim completion for a nonterminal response', async () => {
    const harness = await startHarness((server) => {
      server.setOverride(`POST ${START_PATH}`, {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'op-start', kind: 'recording.start', state: 'RUNNING' }),
      });
    });
    try {
      const result = await harness.callTool({});

      expect(result.isError).toBeFalsy();
      expect(textOf(result)).toContain('Desktop is still starting it');
      expect(textOf(result)).not.toContain('Started workbook');
    } finally {
      await harness.close();
    }
  });

  it('maps a missing route through the standard endpoint error', async () => {
    const harness = await startHarness((server) => {
      server.setOverride(
        `POST ${START_PATH}`,
        problemOverride(404, 'not-found', 'No route matches'),
      );
    });
    try {
      const result = await harness.callTool({});

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('does not serve the start-performance-recording endpoint');
      expect(textOf(result)).toContain('Do not retry');
    } finally {
      await harness.close();
    }
  });

  it.each([
    problemOverride(409, 'performance-recording-disabled', 'Performance recording is disabled.'),
    {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'op-start-failed',
        kind: 'recording.start',
        state: 'FAILED',
        error: {
          code: 'performance-recording-disabled',
          message: 'Performance recording is disabled.',
        },
      }),
    },
  ])('surfaces disabled recording through the MCP error funnel', async (override) => {
    const harness = await startHarness((server) => {
      server.setOverride(`POST ${START_PATH}`, override);
    });
    try {
      const result = await harness.callTool({});

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Performance recording is disabled');
    } finally {
      await harness.close();
    }
  });
});

function textOf(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return result.content[0].text;
}

function startPosts(server: MockExternalApiServer): Array<{ body: string }> {
  return server.requests.filter(
    (request) => request.method === 'POST' && request.path === START_PATH,
  );
}

function problemOverride(status: number, code: string, message: string): MockOverride {
  return {
    status,
    contentType: 'application/problem+json',
    body: JSON.stringify({ type: 'problem', title: message, status, instance: START_PATH, code }),
  };
}

async function startHarness(configure?: (server: MockExternalApiServer) => void): Promise<{
  server: MockExternalApiServer;
  callTool: (args: Record<string, unknown>) => Promise<CallToolResult>;
  close: () => Promise<void>;
}> {
  const server = await startMockExternalApiServer();
  configure?.(server);
  const executor = new ExternalApiToolExecutor({ discover: () => [instanceFor(server)] });
  await executor.start();
  const tool = getStartPerformanceRecordingTool(new DesktopMcpServer());
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
    instanceId: 'inst-start-performance-recording',
    apiVersion: '0.2.11',
  };
}
