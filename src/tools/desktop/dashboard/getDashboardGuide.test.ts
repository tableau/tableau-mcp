import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getGetDashboardGuideTool } from './getDashboardGuide.js';

vi.mock('fs');

import { existsSync, readFileSync } from 'fs';

const GUIDE_CONTENT = '# Dashboard XML Guide\n\nZone structure and best practices.';

describe('getDashboardGuideTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(GUIDE_CONTENT);
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

  it('should return error when guide file does not exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await getResult();

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('not found');
  });

  it('should look for the guide in a resources/desktop directory', async () => {
    await getResult();

    const checkedPaths = vi.mocked(existsSync).mock.calls.map((c) => String(c[0]));
    expect(checkedPaths.some((p) => p.includes('resources') && p.includes('desktop'))).toBe(true);
  });
});

async function getResult(): Promise<CallToolResult> {
  const tool = getGetDashboardGuideTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({}, getMockRequestHandlerExtra());
}
