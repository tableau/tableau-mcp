import * as loggerModule from './logging/logger.js';

const expertiseMocks = vi.hoisted(() => ({
  getExpertiseCorpusEntryCount: vi.fn(() => 0),
  listExpertiseResources: vi.fn(() => []),
  readExpertiseResource: vi.fn(() => null),
}));

vi.mock('./desktop/expertise/index.js', () => expertiseMocks);

vi.mock('./desktop/assets.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./desktop/assets.js')>()),
  getConfiguredExpertiseDir: vi.fn(() => '/app/resources/desktop/expertise'),
}));

import { DesktopMcpServer } from './server.desktop.js';

describe('DesktopMcpServer expertise startup check', () => {
  it('logs one warning naming the expected asset root when the corpus is empty', async () => {
    const logSpy = vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
    const server = new DesktopMcpServer();
    server.mcpServer.registerResource = vi.fn();

    await server.registerResources();
    await server.registerResources();

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith({
      message: 'Expertise corpus is empty; expected assets under /app/resources/desktop/expertise',
      level: 'warning',
      logger: 'DesktopMcpServer',
    });
  });

  it('real expertise resource listing returns [] when no external root is configured', async () => {
    vi.stubEnv('TABLEAU_EXPERTISE_DIR', undefined);

    try {
      vi.resetModules();
      vi.doUnmock('./desktop/expertise/index.js');
      vi.doUnmock('./desktop/assets.js');
      const realExpertise = await import('./desktop/expertise/index.js');
      realExpertise.clearExpertiseCache();
      realExpertise._resetExpertiseSearchCache();

      // Expertise is served only from external roots; with none configured the corpus is
      // empty rather than an error, so the desktop server degrades gracefully.
      expect(realExpertise.listExpertiseResources()).toEqual([]);
    } finally {
      vi.resetModules();
    }
  });
});
