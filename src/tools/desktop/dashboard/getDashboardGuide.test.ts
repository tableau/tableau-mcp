import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getGetDashboardGuideTool } from './getDashboardGuide.js';

vi.mock('../../../desktop/assets.js');

import { readResourceAsset } from '../../../desktop/assets.js';

const GUIDE_CONTENT = '# Dashboard XML Guide\n\nZone structure and best practices.';

describe('getDashboardGuideTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readResourceAsset).mockReturnValue(GUIDE_CONTENT);
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getGetDashboardGuideTool(new DesktopMcpServer());
    expect(tool.name).toBe('get-dashboard-guide');
    expect(tool.annotations).toMatchObject({ readOnlyHint: true });
  });

  it('should return the guide content on success', async () => {
    const result = await getResult();

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(GUIDE_CONTENT);
  });

  it('should return error when guide asset is not available', async () => {
    vi.mocked(readResourceAsset).mockReturnValue(null);

    const result = await getResult();

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not found');
  });

  it('should read the dashboard-xml-guide.md resource asset', async () => {
    await getResult();

    expect(readResourceAsset).toHaveBeenCalledWith('dashboard-xml-guide.md');
  });
});

async function getResult(): Promise<CallToolResult> {
  const tool = getGetDashboardGuideTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({}, getMockRequestHandlerExtra());
}
