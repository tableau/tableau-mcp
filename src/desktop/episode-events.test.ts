import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';

import { getDesktopConfig } from '../config.desktop.js';
import {
  beginEpisode,
  emitEpisodeEvent,
  endEpisode,
  resetEpisodeEventsForTests,
} from './episode-events.js';
import { sessionRouteState } from './route/route-state.js';

const tmpDirs: string[] = [];

function tmpDir(): string {
  const dir = mkdtempSync(join(process.cwd(), 'episode-events-test-'));
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

function config(
  overrides: Partial<ReturnType<typeof getDesktopConfig>> = {},
): ReturnType<typeof getDesktopConfig> {
  return { ...getDesktopConfig(), ...overrides };
}

afterEach(() => {
  resetEpisodeEventsForTests();
  sessionRouteState.clear();
  vi.unstubAllEnvs();
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('episode event writer', () => {
  it('does not create episode files when EPISODE_EVENTS is off', async () => {
    const dir = tmpDir();
    await emitEpisodeEvent(config({ episodeEventsEnabled: false, episodeEventsDirectory: dir }), {
      type: 'tool_start',
      session_id: 'S1',
      tool: 'apply-worksheet',
    });

    expect(readdirSync(dir)).toEqual([]);
  });

  it('writes JSONL with event envelope fields when EPISODE_EVENTS is on', async () => {
    const dir = tmpDir();

    await emitEpisodeEvent(config({ episodeEventsEnabled: true, episodeEventsDirectory: dir }), {
      type: 'tool_start',
      session_id: 'S1',
      episode_id: 'E1',
      tool: 'apply-worksheet',
    });

    const events = readEvents(dir);
    expect(events).toMatchObject([
      {
        type: 'tool_start',
        session_id: 'S1',
        episode_id: 'E1',
        seq: 1,
        tool: 'apply-worksheet',
      },
    ]);
    expect(events[0].ts).toEqual(expect.any(String));
    expect(readdirSync(dir)[0]).toMatch(/^episodes-.*\.jsonl$/);
  });
});

describe('episode lifecycle events', () => {
  it('emits begin and end with pin tuple fields and route receipt', async () => {
    vi.stubEnv('AGENT_TYPES', 'planner,builder');
    vi.stubEnv('SYSTEM_PROMPT_VERSION', 'prompt-v1');
    const dir = tmpDir();
    const cfg = config({
      episodeEventsEnabled: true,
      episodeEventsDirectory: dir,
      desktopSessionId: '4242',
      toolProfile: 'demo',
    });

    const begin = await beginEpisode(cfg, { sessionId: '4242', intent: 'build a chart' });
    sessionRouteState.recordAskClassification('4242', {
      ask: 'SECRET ASK MUST NOT LEAK',
      route: 'bind-first',
      shape: 'bind-first-template',
      template: 'ranking-ordered-bar',
    });
    sessionRouteState.recordAskOutcome('4242', 'SECRET ASK MUST NOT LEAK', 'bound');
    sessionRouteState.recordDeflection('4242', {
      tool: 'build-and-apply-worksheet',
      ts: '2030-01-01T00:00:00Z',
      ask: 'SECRET ASK MUST NOT LEAK',
      template: 'ranking-ordered-bar',
      next_route: 'bind-first',
      text: 'deflection text MUST NOT LEAK',
    });

    await endEpisode(cfg, { sessionId: '4242', status: 'succeeded' });

    const events = readEvents(dir);
    expect(events[0]).toMatchObject({
      type: 'episode_begin',
      session_id: '4242',
      episode_id: begin.episode_id,
      intent: 'build a chart',
      source: 'agent',
      tool_profile: 'demo',
      system_prompt_version: 'prompt-v1',
      agent_types: ['planner', 'builder'],
      tableau_desktop_session_id: '4242',
    });
    expect(events[1]).toMatchObject({
      type: 'episode_end',
      session_id: '4242',
      episode_id: begin.episode_id,
      status: 'succeeded',
      route_receipt: {
        route: 'bind-first',
        shape: 'bind-first-template',
        template: 'ranking-ordered-bar',
        bind_attempts: { count: 1, outcomes: ['bound'] },
        deflections: [
          {
            tool: 'build-and-apply-worksheet',
            ts: '2030-01-01T00:00:00Z',
            template: 'ranking-ordered-bar',
            next_route: 'bind-first',
          },
        ],
      },
    });
    expect(JSON.stringify(events[1].route_receipt)).not.toContain('SECRET ASK');
    expect(JSON.stringify(events[1].route_receipt)).not.toContain('deflection text');
  });

  it('auto-abandons an open episode when a new one begins for the same session', async () => {
    const dir = tmpDir();
    const cfg = config({ episodeEventsEnabled: true, episodeEventsDirectory: dir });

    const first = await beginEpisode(cfg, { sessionId: 'S1' });
    const second = await beginEpisode(cfg, { sessionId: 'S1' });

    expect(readEvents(dir)).toMatchObject([
      { type: 'episode_begin', episode_id: first.episode_id },
      { type: 'episode_end', episode_id: first.episode_id, status: 'abandoned' },
      { type: 'episode_begin', episode_id: second.episode_id },
    ]);
  });
});
