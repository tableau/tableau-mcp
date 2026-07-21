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

  it('throws an honest update-required error when Desktop does not serve the External Client API', async () => {
    mocks.discoverInstances.mockReturnValue([]);

    await expect(new SessionManager().getExecutor('12345')).rejects.toThrow(
      'This Tableau Desktop build does not serve the External Client API — update Desktop.',
    );
  });
});
