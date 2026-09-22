import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { Err, Ok } from 'ts-results-es';

import * as episodeEvents from '../../desktop/episode-events.js';
import { beginEpisode, resetEpisodeEventsForTests } from '../../desktop/episode-events.js';
import { sessionRouteState } from '../../desktop/route/route-state.js';
import { McpToolError } from '../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../server.desktop.js';
import { Provider } from '../../utils/provider.js';
import { DesktopTool } from './tool.js';
import { getMockRequestHandlerExtra } from './toolContext.mock.js';
import { DesktopToolName } from './toolName.js';

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
