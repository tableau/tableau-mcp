import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';

import * as loggerModule from './logging/logger.js';

const knowledgeMocks = vi.hoisted(() => ({
  getKnowledgeCorpusEntryCount: vi.fn(() => 0),
  getKnowledgeDir: vi.fn(() => '/app/resources/desktop/knowledge'),
  listKnowledgeResources: vi.fn(() => []),
  readKnowledgeResource: vi.fn(() => null),
}));

vi.mock('./desktop/knowledge/index.js', () => knowledgeMocks);

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

  it('real knowledge resource listing throws a loud asset-root error for an empty root', async () => {
    const emptyRoot = mkdtempSync(join(process.cwd(), '.tmp-empty-knowledge-root-'));
    const resourcesRoot = join(emptyRoot, 'resources', 'desktop');
    mkdirSync(resourcesRoot, { recursive: true });

    try {
      vi.resetModules();
      vi.doMock('./utils/getDirname.js', () => ({ getDirname: () => emptyRoot }));
      vi.doUnmock('./desktop/knowledge/index.js');
      const realKnowledge = await import('./desktop/knowledge/index.js');
      realKnowledge.clearKnowledgeCache();
      realKnowledge._resetKnowledgeSearchCache();

      expect(() => realKnowledge.listKnowledgeResources()).toThrow(
        `Knowledge corpus is empty; expected assets under ${join(resourcesRoot, 'knowledge')}`,
      );
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true });
      vi.doUnmock('./utils/getDirname.js');
      vi.resetModules();
    }
  });
});
