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
});
