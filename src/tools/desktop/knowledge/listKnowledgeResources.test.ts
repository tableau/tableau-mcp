import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getListKnowledgeResourcesTool } from './listKnowledgeResources.js';

vi.mock('../../../desktop/knowledge/index.js');

import { listKnowledgeResources } from '../../../desktop/knowledge/index.js';

const MOCK_RESOURCES = [
  {
    uri: 'expertise://tableau/strategy/viz-design/chart-selection',
    name: 'Chart Selection',
    description: 'Choose the right chart type.',
    mimeType: 'text/markdown' as const,
  },
  {
    uri: 'expertise://tableau/tactics/viz/filters',
    name: 'Filters',
    description: 'How to use filters.',
    mimeType: 'text/markdown' as const,
  },
];

describe('listKnowledgeResourcesTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listKnowledgeResources).mockReturnValue(MOCK_RESOURCES);
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getListKnowledgeResourcesTool(new DesktopMcpServer());
    expect(tool.name).toBe('list-knowledge-resources');
    expect(tool.annotations).toMatchObject({ readOnlyHint: true });
  });

  it('should return all knowledge resources as JSON', async () => {
    const result = await getResult();

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.resources).toHaveLength(2);
    expect(parsed.resources[0].uri).toBe('expertise://tableau/strategy/viz-design/chart-selection');
  });

  it('should return an explicit asset-root error when no resources exist', async () => {
    vi.mocked(listKnowledgeResources).mockImplementation(() => {
      throw new Error(
        'Knowledge corpus is empty; expected assets under /app/resources/desktop/knowledge',
      );
    });

    const result = await getResult();

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('/app/resources/desktop/knowledge');
  });
});

async function getResult(): Promise<CallToolResult> {
  const tool = getListKnowledgeResourcesTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({}, getMockRequestHandlerExtra());
}
