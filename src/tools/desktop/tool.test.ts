import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { Err, Ok } from 'ts-results-es';

import { Config } from '../../config.desktop.js';
import * as episodeEvents from '../../desktop/episode-events.js';
import { beginEpisode, resetEpisodeEventsForTests } from '../../desktop/episode-events.js';
import { sessionRouteState } from '../../desktop/route/route-state.js';
import { McpToolError } from '../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../server.desktop.js';
import { Provider } from '../../utils/provider.js';
import { DesktopTool } from './tool.js';
import { getMockRequestHandlerExtra } from './toolContext.mock.js';
import { DesktopToolName } from './toolName.js';

// Mock product telemetry so tool calls never hit the network and the `tool_call` payload can be
// asserted directly (mirrors src/tools/web/tool.test.ts).
const mockTelemetrySend = vi.hoisted(() => vi.fn());
const mockGetProductTelemetry = vi.hoisted(() =>
  vi.fn().mockReturnValue({ send: mockTelemetrySend }),
);
vi.mock('../../telemetry/productTelemetry/telemetryForwarder.js', () => ({
  getProductTelemetry: mockGetProductTelemetry,
  DEFAULT_PRODUCT_TELEMETRY_ENDPOINT: 'https://prod.telemetry.tableausoftware.com',
}));

const tmpDirs: string[] = [];

function tmpDir(): string {
  const dir = mkdtempSync(join(process.cwd(), 'desktop-tool-events-test-'));
  tmpDirs.push(dir);
  return dir;
}

function readEvents(dir: string): Array<Record<string, unknown>> {
  const files = readdirSync(dir).filter((file) => /^episodes-.*\.jsonl$/.test(file));
  return files.flatMap((file) =>
    readFileSync(join(dir, file), 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>),
  );
}

afterEach(() => {
  resetEpisodeEventsForTests();
  sessionRouteState.clear();
  mockTelemetrySend.mockClear();
  mockGetProductTelemetry.mockClear();
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('DesktopTool episode telemetry', () => {
  it('emits tool_start and successful tool_end from the execution wrapper', async () => {
    const dir = tmpDir();
    const tool = makeTool();
    const extra = {
      ...getMockRequestHandlerExtra(),
      config: {
        ...getMockRequestHandlerExtra().config,
        episodeEventsEnabled: true,
        episodeEventsDirectory: dir,
      },
    };
    const begin = await beginEpisode(extra.config, { sessionId: 'S1' });

    const result = await tool.logAndExecute({
      extra,
      args: { session: 'S1' },
      callback: async () => new Ok({ ok: true }),
    });

    await vi.waitFor(() => {
      expect(readEvents(dir)).toMatchObject([
        { type: 'episode_begin', episode_id: begin.episode_id },
        {
          type: 'tool_start',
          session_id: 'S1',
          episode_id: begin.episode_id,
          tool: 'ask-user',
        },
        {
          type: 'tool_end',
          session_id: 'S1',
          episode_id: begin.episode_id,
          tool: 'ask-user',
          success: true,
          request_id_hash: expect.stringMatching(/^[a-f0-9]{16}$/),
          result_size_chars: JSON.stringify(result).length,
        },
      ]);
    });
    const events = readEvents(dir);
    expect(events[2].duration_ms).toEqual(expect.any(Number));
  });

  it('returns without waiting for the telemetry sink', async () => {
    const emitSpy = vi
      .spyOn(episodeEvents, 'emitEpisodeEvent')
      .mockImplementation(() => new Promise(() => undefined));

    try {
      const result = await Promise.race([
        makeTool().logAndExecute({
          extra: getMockRequestHandlerExtra(),
          args: { session: 'S1' },
          callback: async () => new Ok({ ok: true }),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('tool waited for telemetry')), 100),
        ),
      ]);

      expect(result.isError).toBe(false);
    } finally {
      emitSpy.mockRestore();
    }
  });

  it('emits tool_error and unsuccessful tool_end when the callback throws', async () => {
    const dir = tmpDir();
    const tool = makeTool();
    const extra = {
      ...getMockRequestHandlerExtra(),
      config: {
        ...getMockRequestHandlerExtra().config,
        episodeEventsEnabled: true,
        episodeEventsDirectory: dir,
      },
    };

    const result = await tool.logAndExecute({
      extra,
      args: { session: 'S1' },
      callback: async () => {
        throw new Error('boom');
      },
    });

    await vi.waitFor(() => {
      expect(readEvents(dir)).toMatchObject([
        { type: 'tool_start', session_id: 'S1', tool: 'ask-user' },
        { type: 'tool_error', session_id: 'S1', tool: 'ask-user' },
        {
          type: 'tool_end',
          session_id: 'S1',
          tool: 'ask-user',
          success: false,
          request_id_hash: expect.stringMatching(/^[a-f0-9]{16}$/),
          result_size_chars: JSON.stringify(result).length,
        },
      ]);
    });
  });

  it('keeps Result.Err telemetry to one start, one error, and one failed end', async () => {
    const dir = tmpDir();
    const tool = makeTool();
    const base = getMockRequestHandlerExtra();
    const extra = {
      ...base,
      config: {
        ...base.config,
        episodeEventsEnabled: true,
        episodeEventsDirectory: dir,
      },
    };

    const result = await tool.logAndExecute({
      extra,
      args: { session: 'S1' },
      callback: async () =>
        new Err(
          new McpToolError({
            type: 'invalid-args',
            message: 'invalid request',
            statusCode: 400,
          }),
        ),
    });

    expect(result.isError).toBe(true);
    await vi.waitFor(() => {
      expect(readEvents(dir).map((event) => event.type)).toEqual([
        'tool_start',
        'tool_error',
        'tool_end',
      ]);
      expect(readEvents(dir).at(-1)).toMatchObject({
        tool: 'ask-user',
        success: false,
        outcome: 'failed',
      });
    });
  });

  it.each([
    ['true', true, false, 'failed', true],
    ['false', false, true, 'succeeded', false],
    ['omitted', undefined, true, 'succeeded', false],
  ] as const)(
    'classifies a mapped result with isError %s without logging its payload',
    async (_label, isError, success, outcome, emitsError) => {
      const dir = tmpDir();
      const tool = makeTool();
      const base = getMockRequestHandlerExtra();
      const extra = {
        ...base,
        config: {
          ...base.config,
          episodeEventsEnabled: true,
          episodeEventsDirectory: dir,
        },
      };
      const begin = await beginEpisode(extra.config, { sessionId: 'S1' });
      const privateSentinel = 'PRIVATE_RESULT_SENTINEL';
      const mappedResult: CallToolResult = {
        ...(isError === undefined ? {} : { isError }),
        content: [{ type: 'text', text: privateSentinel }],
        structuredContent: { privateSentinel },
      };

      const result = await tool.logAndExecute({
        extra,
        args: { session: 'S1' },
        callback: async () => new Ok({ ok: true }),
        getSuccessResult: () => mappedResult,
      });

      expect(result).toBe(mappedResult);
      await vi.waitFor(() => {
        const events = readEvents(dir);
        expect(events.map((event) => event.type)).toEqual(
          emitsError
            ? ['episode_begin', 'tool_start', 'tool_error', 'tool_end']
            : ['episode_begin', 'tool_start', 'tool_end'],
        );
        expect(events[0]).toMatchObject({
          type: 'episode_begin',
          session_id: 'S1',
          episode_id: begin.episode_id,
        });
        for (const event of events.slice(1)) {
          expect(event).toMatchObject({
            session_id: 'S1',
            episode_id: begin.episode_id,
            tool: 'ask-user',
          });
        }
        expect(events.filter((event) => event.type === 'tool_error')).toHaveLength(
          emitsError ? 1 : 0,
        );
        if (emitsError) {
          expect(events.find((event) => event.type === 'tool_error')).toMatchObject({
            error: expect.stringContaining('Tool returned an error result.'),
          });
        }
        expect(events.at(-1)).toMatchObject({
          type: 'tool_end',
          session_id: 'S1',
          tool: 'ask-user',
          success,
          outcome,
          request_id_hash: expect.stringMatching(/^[a-f0-9]{16}$/),
          result_size_chars: JSON.stringify(mappedResult).length,
        });
        expect(JSON.stringify(events)).not.toContain(privateSentinel);
      });
    },
  );
});

describe('DesktopTool worksheet orientation', () => {
  it('executes get-worksheet-xml before authoring and records ordinary success telemetry', async () => {
    const dir = tmpDir();
    const extra = {
      ...getMockRequestHandlerExtra(),
      config: {
        ...getMockRequestHandlerExtra().config,
        episodeEventsEnabled: true,
        episodeEventsDirectory: dir,
      },
    };
    const begin = await beginEpisode(extra.config, { sessionId: 'S1' });
    const callback = vi.fn(async () => new Ok({ worksheetXml: '<worksheet/>' }));

    const result = await makeTool('get-worksheet-xml').logAndExecute({
      extra,
      args: { session: 'S1' },
      callback,
    });

    expect(result.isError).toBe(false);
    expect(callback).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(readEvents(dir)).toMatchObject([
        { type: 'episode_begin', episode_id: begin.episode_id },
        {
          type: 'tool_start',
          session_id: 'S1',
          episode_id: begin.episode_id,
          tool: 'get-worksheet-xml',
        },
        {
          type: 'tool_end',
          session_id: 'S1',
          episode_id: begin.episode_id,
          tool: 'get-worksheet-xml',
          success: true,
          outcome: 'succeeded',
        },
      ]);
    });
  });
});

describe('DesktopTool product telemetry', () => {
  const guid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

  function extraWithConfig(
    overrides: Partial<Config>,
  ): ReturnType<typeof getMockRequestHandlerExtra> {
    const base = getMockRequestHandlerExtra();
    return { ...base, config: { ...base.config, ...overrides } };
  }

  it('sends the Desktop session GUID as session_id, overriding the PID, on success', async () => {
    await makeTool().logAndExecute({
      extra: extraWithConfig({
        desktopSessionId: '4242',
        desktopSessionLuid: guid,
      }),
      args: { session: 'S1' },
      callback: async () => new Ok({ ok: true }),
    });

    expect(mockTelemetrySend).toHaveBeenCalledTimes(1);
    expect(mockTelemetrySend).toHaveBeenCalledWith('tool_call', {
      tool_name: 'ask-user',
      request_id: '2',
      session_id: guid,
      site_luid: '',
      user_luid: '',
      chat_id: '',
      podname: '',
      success: true,
      error_code: '',
      error_message: '',
      oauth_client_id: '',
      oauth_client_display_name: '',
      auth_type: 'desktop',
    });
  });

  it('forwards the signed-in site and user LUID from config', async () => {
    await makeTool().logAndExecute({
      extra: extraWithConfig({
        siteLuid: '11111111-1111-1111-1111-111111111111',
        userLuid: '22222222-2222-2222-2222-222222222222',
      }),
      args: { session: 'S1' },
      callback: async () => new Ok({ ok: true }),
    });

    expect(mockTelemetrySend).toHaveBeenCalledWith(
      'tool_call',
      expect.objectContaining({
        site_luid: '11111111-1111-1111-1111-111111111111',
        user_luid: '22222222-2222-2222-2222-222222222222',
      }),
    );
  });

  it('forwards the agent chat id from config as chat_id', async () => {
    await makeTool().logAndExecute({
      extra: extraWithConfig({ chatId: 'chat-abc-123' }),
      args: { session: 'S1' },
      callback: async () => new Ok({ ok: true }),
    });

    expect(mockTelemetrySend).toHaveBeenCalledWith(
      'tool_call',
      expect.objectContaining({ chat_id: 'chat-abc-123' }),
    );
  });

  it('forwards the Tableau pod name from config as podname', async () => {
    await makeTool().logAndExecute({
      extra: extraWithConfig({ podName: 'some-pod-name' }),
      args: { session: 'S1' },
      callback: async () => new Ok({ ok: true }),
    });

    expect(mockTelemetrySend).toHaveBeenCalledWith(
      'tool_call',
      expect.objectContaining({ podname: 'some-pod-name' }),
    );
  });

  it('builds the telemetry forwarder with the config pod name as the event pod', async () => {
    const extra = extraWithConfig({
      podName: 'some-pod-name',
      productTelemetryEndpoint: 'https://telemetry.example.com',
      productTelemetryEnabled: true,
    });

    await makeTool().logAndExecute({
      extra,
      args: { session: 'S1' },
      callback: async () => new Ok({ ok: true }),
    });

    expect(mockGetProductTelemetry).toHaveBeenCalledWith(
      'https://telemetry.example.com',
      true,
      'some-pod-name',
    );
  });

  it('sends empty session_id when the Desktop GUID is absent, even if a PID is set', async () => {
    await makeTool().logAndExecute({
      extra: extraWithConfig({ desktopSessionId: '4242', desktopSessionLuid: undefined }),
      args: { session: 'S1' },
      callback: async () => new Ok({ ok: true }),
    });

    expect(mockTelemetrySend).toHaveBeenCalledWith(
      'tool_call',
      expect.objectContaining({ session_id: '', success: true }),
    );
  });

  it('reports the McpToolError status code and message on a Result.Err', async () => {
    await makeTool().logAndExecute({
      extra: extraWithConfig({ desktopSessionLuid: guid }),
      args: { session: 'S1' },
      callback: async () =>
        new Err(
          new McpToolError({ type: 'invalid-args', message: 'invalid request', statusCode: 400 }),
        ),
    });

    expect(mockTelemetrySend).toHaveBeenCalledWith(
      'tool_call',
      expect.objectContaining({
        success: false,
        error_code: '400',
        error_message: '',
      }),
    );
  });

  it('reports success=false with an empty error_code on a thrown non-McpToolError', async () => {
    await makeTool().logAndExecute({
      extra: extraWithConfig({ desktopSessionLuid: guid }),
      args: { session: 'S1' },
      callback: async () => {
        throw new Error('boom');
      },
    });

    expect(mockTelemetrySend).toHaveBeenCalledWith(
      'tool_call',
      expect.objectContaining({
        success: false,
        error_code: '',
        error_message: '',
      }),
    );
  });
});

function makeTool(name: DesktopToolName = 'ask-user'): DesktopTool<{ session: any }> {
  return new DesktopTool({
    server: new DesktopMcpServer(),
    name,
    title: 'Ask User',
    description: 'Test tool',
    paramsSchema: { session: { _def: {} } as any },
    annotations: {
      title: 'Ask User',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: new Provider(async () => async () => ({ isError: false, content: [] })),
  });
}
