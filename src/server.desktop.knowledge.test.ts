import * as loggerModule from './logging/logger.js';

const knowledgeMocks = vi.hoisted(() => ({
  getKnowledgeCorpusEntryCount: vi.fn(() => 0),
  listKnowledgeResources: vi.fn(() => []),
  readKnowledgeResource: vi.fn(() => null),
}));

vi.mock('./desktop/knowledge/index.js', () => knowledgeMocks);

vi.mock('./desktop/assets.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./desktop/assets.js')>()),
  getConfiguredKnowledgeDir: vi.fn(() => '/app/resources/desktop/knowledge'),
}));

import { DesktopMcpServer } from './server.desktop.js';

describe('DesktopMcpServer knowledge startup check', () => {
  it('logs one warning naming the expected asset root when the corpus is empty', async () => {
    const logSpy = vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
    const server = new DesktopMcpServer();
    server.mcpServer.registerResource = vi.fn();

    await server.registerResources();
    await server.registerResources();

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith({
      message: 'Knowledge corpus is empty; expected assets under /app/resources/desktop/knowledge',
      level: 'warning',
      logger: 'DesktopMcpServer',
    });
  });

  it('real knowledge resource listing returns [] when no external root is configured', async () => {
    const originalKnowledgeDir = process.env.TABLEAU_KNOWLEDGE_DIR;
    delete process.env.TABLEAU_KNOWLEDGE_DIR;

    try {
      vi.resetModules();
      vi.doUnmock('./desktop/knowledge/index.js');
      vi.doUnmock('./desktop/assets.js');
      const realKnowledge = await import('./desktop/knowledge/index.js');
      realKnowledge.clearKnowledgeCache();
      realKnowledge._resetKnowledgeSearchCache();

      // Knowledge is served only from external roots; with none configured the corpus is
      // empty rather than an error, so the desktop server degrades gracefully.
      expect(realKnowledge.listKnowledgeResources()).toEqual([]);
    } finally {
      if (originalKnowledgeDir === undefined) {
        delete process.env.TABLEAU_KNOWLEDGE_DIR;
      } else {
        process.env.TABLEAU_KNOWLEDGE_DIR = originalKnowledgeDir;
      }
      vi.resetModules();
    }
  });
});
