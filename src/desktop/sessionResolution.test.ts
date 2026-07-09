import * as configModule from '../config.desktop.js';
import { DesktopDiscoverer } from './desktopDiscoverer.js';
import * as externalDiscovery from './externalApi/discovery.js';
import { resolveSession } from './sessionResolution.js';

vi.mock('./desktopDiscoverer.js');

function mockConfig(overrides: Partial<configModule.Config>): void {
  const base = new configModule.Config();
  vi.spyOn(configModule, 'getDesktopConfig').mockReturnValue({
    ...base,
    ...overrides,
  } as configModule.Config);
}

function mockAgentApiInstances(pids: number[]): void {
  const map = new Map(pids.map((pid) => [pid, { pid }]));
  vi.mocked(DesktopDiscoverer).mockImplementation(
    () => ({ getInstances: () => map }) as unknown as DesktopDiscoverer,
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

  it('returns an explicit session id verbatim, ahead of the pin and discovery', () => {
    mockConfig({ desktopSessionId: '4242', externalApiEnabled: false });
    const result = resolveSession('7');
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('7');
  });

  it('falls back to the pinned session id when no explicit session is given', () => {
    mockConfig({ desktopSessionId: '4242', externalApiEnabled: false });
    const result = resolveSession(undefined);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('4242');
  });

  it('auto-resolves the unique Agent API instance when nothing is pinned', () => {
    mockConfig({ desktopSessionId: undefined, externalApiEnabled: false });
    mockAgentApiInstances([99]);
    const result = resolveSession(undefined);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('99');
  });

  it('fails closed when no instances are running and nothing is pinned', () => {
    mockConfig({ desktopSessionId: undefined, externalApiEnabled: false });
    mockAgentApiInstances([]);
    expect(resolveSession(undefined).isErr()).toBe(true);
  });

  it('fails closed when multiple instances are running and nothing is pinned', () => {
    mockConfig({ desktopSessionId: undefined, externalApiEnabled: false });
    mockAgentApiInstances([1, 2]);
    const result = resolveSession(undefined);
    expect(result.isErr()).toBe(true);
    expect(result.unwrapErr().getErrorText()).toContain('1, 2');
  });

  it('auto-resolves via External Client API discovery when that transport is active', () => {
    mockConfig({
      desktopSessionId: undefined,
      externalApiEnabled: true,
      externalApiDiscoveryDir: '/tmp/discovery',
    });
    vi.spyOn(externalDiscovery, 'discoverInstances').mockReturnValue([
      { pid: 555 } as ReturnType<typeof externalDiscovery.discoverInstances>[number],
    ]);
    const result = resolveSession(undefined);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('555');
  });
});
