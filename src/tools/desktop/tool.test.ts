import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { Ok } from 'ts-results-es';

import { beginEpisode, resetEpisodeEventsForTests } from '../../desktop/episode-events.js';
import { sessionRouteState } from '../../desktop/route/route-state.js';
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

    await tool.logAndExecute({
      extra,
      args: { session: 'S1' },
      callback: async () => new Ok({ ok: true }),
    });

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
      },
    ]);
    expect(readEvents(dir)[2].duration_ms).toEqual(expect.any(Number));
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

    await tool.logAndExecute({
      extra,
      args: { session: 'S1' },
      callback: async () => {
        throw new Error('boom');
      },
    });

    expect(readEvents(dir)).toMatchObject([
      { type: 'tool_start', session_id: 'S1', tool: 'ask-user' },
      { type: 'tool_error', session_id: 'S1', tool: 'ask-user' },
      { type: 'tool_end', session_id: 'S1', tool: 'ask-user', success: false },
    ]);
  });
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
