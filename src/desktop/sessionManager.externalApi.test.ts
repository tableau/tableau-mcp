import { ExternalApiToolExecutor } from './externalApi/externalApiToolExecutor.js';
import { SessionManager } from './sessionManager.js';

const mocks = vi.hoisted(() => ({
  discoverInstances: vi.fn(() => []),
}));

vi.mock('./externalApi/discovery.js', () => ({
  discoverInstances: mocks.discoverInstances,
}));

describe('SessionManager executor selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('creates an ExternalApiToolExecutor without a transport flag', async () => {
    mocks.discoverInstances.mockReturnValue([
      {
        baseUrl: 'http://127.0.0.1:8765',
        token: 'token',
        pid: 12345,
        instanceId: 'inst',
      },
    ] as never);

    const executor = await new SessionManager().getExecutor('12345');

    expect(executor).toBeInstanceOf(ExternalApiToolExecutor);
  });

  it('wires the configured 90 second timeout into External API requests', async () => {
    vi.stubEnv('TABLEAU_DESKTOP_CALL_TIMEOUT_MS', '90000');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<workbook />', { status: 200 })),
    );
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    mocks.discoverInstances.mockReturnValue([
      {
        baseUrl: 'http://127.0.0.1:8765',
        token: 'token',
        pid: 12345,
        instanceId: 'inst',
      },
    ] as never);

    const executor = await new SessionManager().getExecutor('12345');
    const result = await executor.getWorkbookDocument(new AbortController().signal);

    expect(result.isOk()).toBe(true);
    expect(timeoutSpy).toHaveBeenCalledWith(90_000);
  });

  it('throws an honest update-required error when an unpinned Desktop does not serve the External Client API', async () => {
    mocks.discoverInstances.mockReturnValue([]);

    await expect(new SessionManager().getExecutor('12345')).rejects.toThrow(
      'This Tableau Desktop build does not serve the External Client API — update Desktop.',
    );
  });

  it('throws a restart-recovery error when the pinned Desktop is no longer reachable', async () => {
    vi.stubEnv('TABLEAU_DESKTOP_SESSION_ID', '12345');
    mocks.discoverInstances.mockReturnValue([]);

    await expect(new SessionManager().getExecutor('12345')).rejects.toThrow(
      'The pinned Tableau Desktop is no longer reachable — it was closed or restarted. Relaunch the agent from Tableau Desktop to reconnect.',
    );
  });

  it('throws a stale-session error when an unpinned session is gone but other instances are running', async () => {
    mocks.discoverInstances.mockReturnValue([
      {
        baseUrl: 'http://127.0.0.1:8765',
        token: 'token',
        pid: 999,
        instanceId: 'inst',
      },
    ] as never);

    await expect(new SessionManager().getExecutor('12345')).rejects.toThrow(
      'No Desktop instance found with PID 12345. Session 12345 is stale: that Tableau Desktop process is no longer reachable or was restarted. Call list-instances and retry with the current session.',
    );
  });

  it('throws a stale-session error when a pinned config targets a different, still-running Desktop', async () => {
    vi.stubEnv('TABLEAU_DESKTOP_SESSION_ID', '999');
    mocks.discoverInstances.mockReturnValue([
      {
        baseUrl: 'http://127.0.0.1:8765',
        token: 'token',
        pid: 999,
        instanceId: 'inst',
      },
    ] as never);

    await expect(new SessionManager().getExecutor('12345')).rejects.toThrow(
      'No Desktop instance found with PID 12345. Session 12345 is stale: that Tableau Desktop process is no longer reachable or was restarted. Call list-instances and retry with the current session.',
    );
  });
});
