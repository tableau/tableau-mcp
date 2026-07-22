import * as configModule from '../config.desktop.js';
import * as externalDiscovery from './externalApi/discovery.js';
import { resolveSession } from './sessionResolution.js';

function mockConfig(overrides: Partial<configModule.Config>): void {
  const base = new configModule.Config();
  vi.spyOn(configModule, 'getDesktopConfig').mockReturnValue({
    ...base,
    ...overrides,
  } as configModule.Config);
}

function mockExternalApiInstances(pids: number[]): void {
  vi.spyOn(externalDiscovery, 'discoverInstances').mockReturnValue(
    pids.map((pid) => ({ pid }) as ReturnType<typeof externalDiscovery.discoverInstances>[number]),
  );
}

describe('resolveSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('TABLEAU_MCP_TEST', 'true');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('honors an explicit live session that differs from the pin', () => {
    mockConfig({ desktopSessionId: '4242' });
    mockExternalApiInstances([4242, 7]);
    const result = resolveSession('7');
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('7');
  });

  it('rejects an explicit session that is not a running instance (pinned)', () => {
    mockConfig({ desktopSessionId: '4242' });
    mockExternalApiInstances([4242]);
    const result = resolveSession('7');
    expect(result.isErr()).toBe(true);
    const text = result.unwrapErr().getErrorText();
    expect(text).toContain('7');
    expect(text).toContain('list-instances');
  });

  it('honors an explicit session that matches the pin', () => {
    mockConfig({ desktopSessionId: '4242' });
    const result = resolveSession('4242');
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('4242');
  });

  it('uses the pinned session id when no explicit session is given', () => {
    mockConfig({ desktopSessionId: '4242' });
    const result = resolveSession(undefined);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('4242');
  });

  it('treats an empty explicit session as absent when pinned', () => {
    mockConfig({ desktopSessionId: '4242' });
    const result = resolveSession('');
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('4242');
  });

  it('treats the sentinel "default" as absent when pinned (no spurious pin-mismatch)', () => {
    // Some clients inject session:"default" as a placeholder; before the fix that literal
    // was compared against the pinned pid and failed closed on every session-scoped call.
    mockConfig({ desktopSessionId: '4242' });
    for (const sentinel of ['default', 'Default', ' DEFAULT ']) {
      const result = resolveSession(sentinel);
      expect(result.isOk(), `"${sentinel}" should resolve to the pin`).toBe(true);
      expect(result.unwrap()).toBe('4242');
    }
  });

  it('returns an explicit live session id when nothing is pinned', () => {
    mockConfig({ desktopSessionId: undefined });
    mockExternalApiInstances([7]);
    const result = resolveSession('7');
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('7');
  });

  it('rejects an explicit session that is not a running instance when unpinned', () => {
    mockConfig({ desktopSessionId: undefined });
    mockExternalApiInstances([99]);
    const result = resolveSession('7');
    expect(result.isErr()).toBe(true);
    const text = result.unwrapErr().getErrorText();
    expect(text).toContain('7');
    expect(text).toContain('list-instances');
  });

  it('accepts an explicit session when discovery is empty and nothing is pinned (deliberate fail-open)', () => {
    mockConfig({ desktopSessionId: undefined });
    mockExternalApiInstances([]);
    const result = resolveSession('7');
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('7');
  });

  it('accepts an explicit session that differs from the pin when discovery is empty', () => {
    mockConfig({ desktopSessionId: '4242' });
    mockExternalApiInstances([]);
    const result = resolveSession('7');
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('7');
  });

  it('auto-resolves the unique External API instance when nothing is pinned', () => {
    mockConfig({ desktopSessionId: undefined });
    mockExternalApiInstances([99]);
    const result = resolveSession(undefined);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('99');
  });

  it('treats a whitespace-only explicit session as absent when auto-resolving', () => {
    mockConfig({ desktopSessionId: undefined });
    mockExternalApiInstances([99]);
    const result = resolveSession('   ');
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('99');
  });

  it('fails closed when no instances are running and nothing is pinned', () => {
    mockConfig({ desktopSessionId: undefined });
    mockExternalApiInstances([]);
    expect(resolveSession(undefined).isErr()).toBe(true);
  });

  it('fails closed when multiple instances are running and nothing is pinned', () => {
    mockConfig({ desktopSessionId: undefined });
    mockExternalApiInstances([1, 2]);
    const result = resolveSession(undefined);
    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().getErrorText()).toContain('1, 2');
  });

  it('passes the configured External Client API discovery dir to discovery', () => {
    mockConfig({
      desktopSessionId: undefined,
      externalApiDiscoveryDir: '/tmp/discovery',
    });
    const discoverSpy = vi
      .spyOn(externalDiscovery, 'discoverInstances')
      .mockReturnValue([
        { pid: 555 } as ReturnType<typeof externalDiscovery.discoverInstances>[number],
      ]);
    const result = resolveSession(undefined);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('555');
    expect(discoverSpy).toHaveBeenCalledWith({ discoveryDir: '/tmp/discovery' });
  });
});
