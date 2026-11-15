import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { DesktopMcpServer } from '../../../../server.desktop.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getReadExpertiseResourceTool } from './readExpertiseResource.js';

vi.mock('../../../../desktop/expertise/index.js');

import { readExpertiseResource } from '../../../../desktop/expertise/index.js';

const SAMPLE_CONTENT = '# Chart Selection\n\nChoose the right chart type for your data.';

describe('readExpertiseResourceTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getReadExpertiseResourceTool(new DesktopMcpServer());
    expect(tool.name).toBe('read-expertise-resource');
    expect(tool.annotations).toMatchObject({ readOnlyHint: true });
    expect(tool.paramsSchema).toMatchObject({ uri: expect.any(Object) });
  });

  it('should return markdown content for a valid URI', async () => {
    vi.mocked(readExpertiseResource).mockReturnValue(SAMPLE_CONTENT);

    const result = await getResult('expertise://tableau/strategy/viz-design/chart-selection');

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(SAMPLE_CONTENT);
  });

  it('should return error for an unknown URI', async () => {
    vi.mocked(readExpertiseResource).mockReturnValue(null);

    const result = await getResult('expertise://tableau/nonexistent');

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not found');
    expect(result.content[0].text).toContain('search-expertise');
  });

  it('should pass the URI directly to readExpertiseResource', async () => {
    vi.mocked(readExpertiseResource).mockReturnValue(SAMPLE_CONTENT);
    const uri = 'expertise://tableau/tactics/viz/filters';

    await getResult(uri);

    expect(readExpertiseResource).toHaveBeenCalledWith(uri);
  });
});

async function getResult(uri: string): Promise<CallToolResult> {
  const tool = getReadExpertiseResourceTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ uri }, getMockRequestHandlerExtra());
}
