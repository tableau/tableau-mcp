import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';

import * as configModule from '../../../config.desktop.js';
import { resetEpisodeEventsForTests } from '../../../desktop/episode-events.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getBeginEpisodeTool, getEndEpisodeTool } from './episodeTools.js';

const tmpDirs: string[] = [];

function tmpDir(): string {
  const dir = mkdtempSync(join(process.cwd(), 'episode-tools-test-'));
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
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('episode lifecycle tools', () => {
  it('begin and end tools return text that includes the episode_id', async () => {
    const dir = tmpDir();
    const cfg = {
      ...configModule.getDesktopConfig(),
      episodeEventsEnabled: true,
      episodeEventsDirectory: dir,
    };
    const extra = { ...getMockRequestHandlerExtra(), config: cfg };

    const beginTool = getBeginEpisodeTool(new DesktopMcpServer());
    const begin = await (
      await Provider.from(beginTool.callback)
    )({ session: 'S1', intent: 'chart request' }, extra);

    expect(begin.isError).toBe(false);
    expect(begin.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringMatching(/episode_id=/),
    });
    const beginText = textContent(begin);
    const episodeId = /episode_id=([a-f0-9-]+)/.exec(beginText)?.[1];
    expect(episodeId).toBeTruthy();

    const endTool = getEndEpisodeTool(new DesktopMcpServer());
    const end = await (
      await Provider.from(endTool.callback)
    )({ session: 'S1', status: 'succeeded', notes: undefined }, extra);

    expect(end.isError).toBe(false);
    expect(textContent(end)).toContain(`episode_id=${episodeId}`);
    const lifecycleEvents = readEvents(dir).filter(
      (event) => event.type === 'episode_begin' || event.type === 'episode_end',
    );
    expect(lifecycleEvents).toMatchObject([
      { type: 'episode_begin', episode_id: episodeId },
      { type: 'episode_end', episode_id: episodeId, status: 'succeeded' },
    ]);
  });

  it('registers episode tools only when EPISODE_EVENTS=on', async () => {
    const offServer = serverWithRegisterSpy();
    await offServer.registerTools();
    const offNames = vi.mocked(offServer.mcpServer.registerTool).mock.calls.map((call) => call[0]);
    expect(offNames).not.toContain('tableau-begin-episode');
    expect(offNames).not.toContain('tableau-end-episode');

    vi.stubEnv('EPISODE_EVENTS', 'on');
    const onServer = serverWithRegisterSpy();
    await onServer.registerTools();
    const onNames = vi.mocked(onServer.mcpServer.registerTool).mock.calls.map((call) => call[0]);
    expect(onNames).toContain('tableau-begin-episode');
    expect(onNames).toContain('tableau-end-episode');
  });
});

function serverWithRegisterSpy(): DesktopMcpServer {
  const server = new DesktopMcpServer();
  server.mcpServer.registerTool = vi.fn();
  return server;
}

function textContent(result: { content: Array<{ type: string; text?: string }> }): string {
  const first = result.content[0];
  if (first.type !== 'text' || first.text === undefined) {
    throw new Error('Expected text tool result');
  }
  return first.text;
}
