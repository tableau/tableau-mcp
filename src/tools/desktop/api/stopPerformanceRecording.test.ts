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
import { getStopPerformanceRecordingTool } from './stopPerformanceRecording.js';

vi.mock('../../../desktop/session/sessionResolution.js');

const STOP_PATH = '/v0/workbook:stopPerformanceRecording';

describe('stop-performance-recording tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('declares the 0.2.11 floor and non-idempotent recorder metadata', () => {
    const tool = getStopPerformanceRecordingTool(new DesktopMcpServer());

    expect(tool.minApiVersion).toBe('0.2.11');
    expect(tool.paramsSchema).toMatchObject({ session: expect.any(Object) });
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it('sends a bodyless POST and returns the validated Desktop-local path', async () => {
    const harness = await startHarness();
    try {
      const result = await harness.callTool({ session: '999' });

      expect(result.isError).toBeFalsy();
      expect(JSON.parse(textOf(result))).toEqual({
        filePath: 'C:/Temp/PerformanceRecording.twbx',
        message:
          'Stopped workbook performance recording. Tableau Desktop created the packaged recording at "C:/Temp/PerformanceRecording.twbx".',
      });
      expect(sessionResolution.resolveSession).toHaveBeenCalledWith('999');
      expect(stopPosts(harness.server)).toEqual([expect.objectContaining({ body: '' })]);
    } finally {
      await harness.close();
    }
  });

  it('polls an accepted stop operation to its terminal packaged path', async () => {
    const harness = await startHarness((server) => {
      server.setOverride(`POST ${STOP_PATH}`, {
        status: 202,
        contentType: 'application/json',
        headers: { location: '/v0/operations/op-stop', 'retry-after': '0' },
        body: JSON.stringify({ id: 'op-stop', kind: 'recording.stop', state: 'RUNNING' }),
      });
      server.setOperation('op-stop', {
        retryAfterSeconds: 0,
        poll: [
          { id: 'op-stop', kind: 'recording.stop', state: 'RUNNING' },
          {
            id: 'op-stop',
            kind: 'recording.stop',
            state: 'SUCCEEDED',
            result: { filePath: 'D:/Recordings/PerformanceRecording.twbx' },
          },
        ],
      });
    });
    try {
      const result = await harness.callTool({});

      expect(result.isError).toBeFalsy();
      expect(JSON.parse(textOf(result))).toMatchObject({
        filePath: 'D:/Recordings/PerformanceRecording.twbx',
      });
      expect(harness.server.requests.map((request) => request.path)).toContain(
        '/v0/operations/op-stop',
      );
    } finally {
      await harness.close();
    }
  });

  it('does not fabricate a filePath for a nonterminal response', async () => {
    const harness = await startHarness((server) => {
      server.setOverride(`POST ${STOP_PATH}`, {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'op-stop', kind: 'recording.stop', state: 'RUNNING' }),
      });
    });
    try {
      const result = await harness.callTool({});
      const payload = JSON.parse(textOf(result)) as Record<string, unknown>;

      expect(result.isError).toBeFalsy();
      expect(payload.filePath).toBeUndefined();
      expect(payload.message).toContain('Desktop is still stopping it');
    } finally {
      await harness.close();
    }
  });

  it('maps a missing route through the standard endpoint error', async () => {
    const harness = await startHarness((server) => {
      server.setOverride(
        `POST ${STOP_PATH}`,
        problemOverride(404, 'not-found', 'No route matches'),
      );
    });
    try {
      const result = await harness.callTool({});

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('does not serve the stop-performance-recording endpoint');
      expect(textOf(result)).toContain('Do not retry');
    } finally {
      await harness.close();
    }
  });

  it.each([
    problemOverride(
      409,
      'performance-recording-not-active',
      'Performance recording is not active.',
    ),
    {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'op-stop-failed',
        kind: 'recording.stop',
        state: 'FAILED',
        error: {
          code: 'performance-recording-not-active',
          message: 'Performance recording is not active.',
        },
      }),
    },
  ])('surfaces inactive recording through the MCP error funnel', async (override) => {
    const harness = await startHarness((server) => {
      server.setOverride(`POST ${STOP_PATH}`, override);
    });
    try {
      const result = await harness.callTool({});

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Performance recording is not active');
    } finally {
      await harness.close();
    }
  });

  it('surfaces malformed terminal output through the MCP error funnel', async () => {
    const harness = await startHarness((server) => {
      server.setOverride(`POST ${STOP_PATH}`, {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'op-stop-malformed',
          kind: 'recording.stop',
          state: 'SUCCEEDED',
          result: {},
        }),
      });
    });
    try {
      const result = await harness.callTool({});

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('invalid-response');
    } finally {
      await harness.close();
    }
  });
});

function textOf(result: CallToolResult): string {
  invariant(result.content[0].type === 'text');
  return result.content[0].text;
}

function stopPosts(server: MockExternalApiServer): Array<{ body: string }> {
  return server.requests.filter(
    (request) => request.method === 'POST' && request.path === STOP_PATH,
  );
}

function problemOverride(status: number, code: string, message: string): MockOverride {
  return {
    status,
    contentType: 'application/problem+json',
    body: JSON.stringify({ type: 'problem', title: message, status, instance: STOP_PATH, code }),
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
  const tool = getStopPerformanceRecordingTool(new DesktopMcpServer());
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
    instanceId: 'inst-stop-performance-recording',
    apiVersion: '0.2.11',
  };
}
