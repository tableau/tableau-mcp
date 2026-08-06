import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { Ok } from 'ts-results-es';

import { beginEpisode, resetEpisodeEventsForTests } from '../../desktop/episode-events.js';
import * as externalDiscovery from '../../desktop/externalApi/discovery.js';
import { sessionRouteState } from '../../desktop/route/route-state.js';
import { ArgsValidationError } from '../../errors/mcpToolError.js';
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

describe('DesktopTool authoring attempt telemetry', () => {
  it('executes get-worksheet-xml before any authoring attempt', async () => {
    const callback = vi.fn(async () => new Ok({ worksheetXml: '<worksheet/>' }));

    const result = await makeTool('get-worksheet-xml').logAndExecute({
      extra: getMockRequestHandlerExtra(),
      args: { session: 'S1' },
      callback,
    });

    expect(result.isError).toBe(false);
    expect(callback).toHaveBeenCalledOnce();
  });

  it('records an initial worksheet read as succeeded in the episode stream', async () => {
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
    const gatedCallback = vi.fn(async () => new Ok({ fields: [] }));

    const result = await makeTool('get-worksheet-xml').logAndExecute({
      extra,
      args: { session: 'S1' },
      callback: gatedCallback,
    });
    await makeTool().logAndExecute({
      extra,
      args: { session: 'S1' },
      callback: async () => new Ok({ answer: 'continue' }),
    });

    expect(result.isError).toBe(false);
    expect(gatedCallback).toHaveBeenCalledOnce();
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
      { type: 'tool_start', tool: 'ask-user' },
      { type: 'tool_end', tool: 'ask-user', success: true, outcome: 'succeeded' },
    ]);
  });

  it('invokes the executor seam for an initial worksheet read', async () => {
    const getExecutor = vi.fn();
    const extra = { ...getMockRequestHandlerExtra(), getExecutor };
    const tool = makeTool('get-worksheet-xml');

    const result = await tool.logAndExecute({
      extra,
      args: { session: 'S1' },
      callback: async () => {
        await getExecutor('S1');
        return new Ok({ fields: [] });
      },
    });

    expect(result.isError).toBe(false);
    expect(getExecutor).toHaveBeenCalledWith('S1');
  });

  it('executes orientation after a failed bind-template attempt', async () => {
    const extra = getMockRequestHandlerExtra();
    const failedBind = await makeTool('bind-template').logAndExecute({
      extra,
      args: { session: 'S1' },
      callback: async () => new ArgsValidationError('expected bind failure').toErr(),
    });
    const orientationCallback = vi.fn(async () => new Ok({ fields: [] }));

    const orientation = await makeTool('get-worksheet-xml').logAndExecute({
      extra,
      args: { session: 'S1' },
      callback: orientationCallback,
    });

    expect(failedBind.isError).toBe(true);
    expect(orientation.isError).toBe(false);
    expect(orientationCallback).toHaveBeenCalledOnce();
  });

  it('executes orientation after author-parameter', async () => {
    const extra = getMockRequestHandlerExtra();
    await makeTool('author-parameter').logAndExecute({
      extra,
      args: { session: 'S1' },
      callback: async () => new Ok({ parameterName: '[Parameter 1]' }),
    });
    const orientationCallback = vi.fn(async () => new Ok({ worksheetXml: '<worksheet/>' }));

    await makeTool('get-worksheet-xml').logAndExecute({
      extra,
      args: { session: 'S1' },
      callback: orientationCallback,
    });

    expect(orientationCallback).toHaveBeenCalledOnce();
  });

  it('does not require another session to unlock worksheet reads', async () => {
    const extra = getMockRequestHandlerExtra();
    await makeTool('author-set').logAndExecute({
      extra,
      args: { session: 'S1' },
      callback: async () => new Ok({ setName: '[Top Customers]' }),
    });
    const orientationCallback = vi.fn(async () => new Ok({ fields: [] }));

    const result = await makeTool('get-worksheet-xml').logAndExecute({
      extra,
      args: { session: 'S2' },
      callback: orientationCallback,
    });

    expect(result.isError).toBe(false);
    expect(orientationCallback).toHaveBeenCalledOnce();
  });

  it('allows list-available-fields before an authoring attempt', async () => {
    const callback = vi.fn(async () => new Ok({ fields: [] }));

    const result = await makeTool('list-available-fields').logAndExecute({
      extra: getMockRequestHandlerExtra(),
      args: { session: 'S1' },
      callback,
    });

    expect(result.isError).toBe(false);
    expect(callback).toHaveBeenCalledOnce();
    expect(sessionRouteState.hasAuthoringAttempt('S1')).toBe(false);
  });

  it.each([
    'bind-template',
    'author-parameter',
    'author-set',
    'author-calc',
    'author-action',
    'add-field',
    'apply-worksheet',
    'refine-worksheet',
    'execute-tableau-command',
  ] as const)('records %s before its callback fails', async (name) => {
    await makeTool(name).logAndExecute({
      extra: getMockRequestHandlerExtra(),
      args: { session: 'S1' },
      callback: async () => new ArgsValidationError('expected failure').toErr(),
    });

    expect(sessionRouteState.hasAuthoringAttempt('S1')).toBe(true);
    expect(sessionRouteState.get('S1')?.firstAuthoringAttempt?.tool).toBe(name);
  });

  it('records an omitted session against the resolved single Desktop session', async () => {
    vi.spyOn(externalDiscovery, 'discoverInstances').mockReturnValue([
      { pid: 4242 } as ReturnType<typeof externalDiscovery.discoverInstances>[number],
    ]);

    await makeTool('author-calc').logAndExecute({
      extra: getMockRequestHandlerExtra(),
      args: {} as any,
      callback: async () => new Ok({ calculationName: '[Profit Ratio]' }),
    });

    expect(sessionRouteState.hasAuthoringAttempt('4242')).toBe(true);
    expect(sessionRouteState.get('4242')?.firstAuthoringAttempt?.tool).toBe('author-calc');
    expect(sessionRouteState.get(undefined)).toBeUndefined();
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
