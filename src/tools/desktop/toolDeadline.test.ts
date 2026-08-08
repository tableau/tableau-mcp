import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { Ok } from 'ts-results-es';

import { createCallDeadline } from '../../desktop/callDeadline.js';
import { beginEpisode, resetEpisodeEventsForTests } from '../../desktop/episode-events.js';
import { DesktopMcpServer } from '../../server.desktop.js';
import { Provider } from '../../utils/provider.js';
import { DesktopTool } from './tool.js';
import { getMockRequestHandlerExtra } from './toolContext.mock.js';

const tmpDirs: string[] = [];

function tmpDir(): string {
  const dir = mkdtempSync(join(process.cwd(), 'desktop-deadline-test-'));
  tmpDirs.push(dir);
  return dir;
}

function readEvents(dir: string): Array<Record<string, unknown>> {
  return readdirSync(dir)
    .filter((file) => /^episodes-.*\.jsonl$/.test(file))
    .flatMap((file) =>
      readFileSync(join(dir, file), 'utf-8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    );
}

function makeTool(): DesktopTool<{ session: any }> {
  return new DesktopTool({
    server: new DesktopMcpServer(),
    name: 'apply-workbook',
    title: 'Apply Workbook',
    description: 'Test tool',
    paramsSchema: { session: { _def: {} } as any },
    annotations: {
      title: 'Apply Workbook',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: new Provider(async () => async () => ({ isError: false, content: [] })),
  });
}

function makeExtra(dir?: string, budgetMs = 60_000): any {
  const base = getMockRequestHandlerExtra();
  const deadline = createCallDeadline({ budgetMs });
  return {
    ...base,
    signal: deadline.signal,
    deadline,
    config: dir
      ? { ...base.config, episodeEventsEnabled: true, episodeEventsDirectory: dir }
      : base.config,
  };
}

afterEach(() => {
  resetEpisodeEventsForTests();
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe('DesktopTool per-call deadline', () => {
  it('cuts a call that outruns the budget and returns the honest, actionable error', async () => {
    vi.useFakeTimers();
    const tool = makeTool();
    const extra = makeExtra(undefined, 60_000);

    const pending = tool.logAndExecute({
      extra,
      args: { session: '31875' },
      // A wedged Desktop: the request never settles.
      callback: () => new Promise(() => undefined),
    });

    await vi.advanceTimersByTimeAsync(60_000);
    const result = await pending;

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).toContain('Tableau Desktop did not respond within 60s');
    expect(text).toContain('session: 31875');
    expect(text).toContain('blocking dialog');
    expect(text).toContain('Do not retry this call');
    // Not dressed up as a generic tool failure the agent can paper over.
    expect(text).not.toContain('requestId:');

    extra.deadline.dispose();
  });

  it('aborts the signal the tool handed to Desktop, so the request does not keep running', async () => {
    vi.useFakeTimers();
    const tool = makeTool();
    const extra = makeExtra(undefined, 60_000);
    let abortedWith: unknown;

    const pending = tool.logAndExecute({
      extra,
      args: { session: '31875' },
      callback: () =>
        new Promise(() => {
          extra.signal.addEventListener('abort', () => {
            abortedWith = extra.signal.reason;
          });
        }),
    });

    await vi.advanceTimersByTimeAsync(60_000);
    await pending;

    expect(abortedWith).toBeInstanceOf(Error);
    expect((abortedWith as Error).name).toBe('DesktopCallTimeoutError');
    extra.deadline.dispose();
  });

  it('does not cut the real 37.5s apply-workbook', async () => {
    vi.useFakeTimers();
    const tool = makeTool();
    const extra = makeExtra(undefined, 60_000);

    const pending = tool.logAndExecute<{ applied: boolean }>({
      extra,
      args: { session: '31875' },
      callback: () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(new Ok({ applied: true })), 37_543);
        }),
    });

    await vi.advanceTimersByTimeAsync(37_543);
    const result = await pending;

    expect(result.isError).toBe(false);
    expect(extra.deadline.expired()).toBe(false);
    extra.deadline.dispose();
  });

  it('records the timeout as a failed call instead of a silent success', async () => {
    vi.useFakeTimers();
    const dir = tmpDir();
    const tool = makeTool();
    const extra = makeExtra(dir, 60_000);
    await beginEpisode(extra.config, { sessionId: '31875' });

    const pending = tool.logAndExecute({
      extra,
      args: { session: '31875' },
      callback: () => new Promise(() => undefined),
    });
    await vi.advanceTimersByTimeAsync(60_000);
    await pending;
    vi.useRealTimers();

    await vi.waitFor(() => {
      expect(readEvents(dir)).toMatchObject([
        { type: 'episode_begin' },
        { type: 'tool_start', tool: 'apply-workbook' },
        { type: 'tool_error', tool: 'apply-workbook' },
        { type: 'tool_end', tool: 'apply-workbook', success: false },
      ]);
    });
    const toolError = readEvents(dir)[2];
    expect(String(toolError.error)).toContain('did not respond within 60s');

    extra.deadline.dispose();
  });

  it('leaves no unhandled rejection when the cut-off call later fails on its own', async () => {
    vi.useFakeTimers();
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    try {
      const tool = makeTool();
      const extra = makeExtra(undefined, 60_000);

      const pending = tool.logAndExecute({
        extra,
        args: { session: '31875' },
        callback: () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error('socket closed long after we gave up')), 90_000);
          }),
      });

      await vi.advanceTimersByTimeAsync(60_000);
      const result = await pending;
      expect(result.isError).toBe(true);

      await vi.advanceTimersByTimeAsync(60_000);
      extra.deadline.dispose();

      vi.useRealTimers();
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('runs unchanged when no deadline is attached', async () => {
    const tool = makeTool();
    const base = getMockRequestHandlerExtra();

    const result = await tool.logAndExecute({
      extra: base,
      args: { session: 'S1' },
      callback: async () => new Ok({ ok: true }),
    });

    expect(result.isError).toBe(false);
  });
});
