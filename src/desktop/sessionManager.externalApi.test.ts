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
});
