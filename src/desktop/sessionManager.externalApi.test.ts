import { ExternalApiToolExecutor } from './externalApi/externalApiToolExecutor.js';
import { SessionManager } from './sessionManager.js';
import { LocalExecutor } from './toolExecutor/localToolExecutor.js';

vi.mock('./externalApi/discovery.js', () => ({
  discoverInstances: vi.fn(() => []),
}));

describe('SessionManager executor selection', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates an ExternalApiToolExecutor when TABLEAU_EXTERNAL_API is enabled', async () => {
    vi.stubEnv('TABLEAU_EXTERNAL_API', '1');

    const executor = await new SessionManager().getExecutor('12345');

    expect(executor).toBeInstanceOf(ExternalApiToolExecutor);
    expect(executor).not.toBeInstanceOf(LocalExecutor);
  });
});
