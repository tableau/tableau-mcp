import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import * as searchLibrary from '../../../desktop/search/searchLibrary.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getSearchCommandsTool } from './searchCommands.js';

vi.mock('../../../desktop/search/searchLibrary.js');

const MOCK_COMMANDS_RESULT = {
  commands: [
    {
      command_name: 'GoTo.Sheet',
      fully_qualified_serialized_name: 'GoTo.Sheet',
      description: 'Navigate to a sheet',
      parameters: [],
    },
  ],
};

describe('searchCommandsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getSearchCommandsTool(new DesktopMcpServer());
    expect(tool.name).toBe('search-commands');
    expect(tool.description).toContain('commands reference');
    expect(tool.paramsSchema).toMatchObject({ keywords: expect.any(Object) });
    expect(tool.annotations).toMatchObject({ readOnlyHint: true });
  });

  it('should return the result from searchCommandsByKeywords as JSON', async () => {
    vi.mocked(searchLibrary.searchCommandsByKeywords).mockReturnValue(MOCK_COMMANDS_RESULT);

    const result = await getResult({ keywords: ['sheet'] });

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.commands).toHaveLength(1);
    expect(parsed.commands[0].command_name).toBe('GoTo.Sheet');
  });

  it('should pass keywords array to searchCommandsByKeywords', async () => {
    vi.mocked(searchLibrary.searchCommandsByKeywords).mockReturnValue({ commands: [] });

    await getResult({ keywords: ['goto', 'sheet'] });

    expect(searchLibrary.searchCommandsByKeywords).toHaveBeenCalledWith(['goto', 'sheet']);
  });

  it('should pass an empty keywords array and return up to 25 commands', async () => {
    vi.mocked(searchLibrary.searchCommandsByKeywords).mockReturnValue({ commands: [] });

    await getResult({ keywords: [] });

    expect(searchLibrary.searchCommandsByKeywords).toHaveBeenCalledWith([]);
  });

  it('should include recommendation when no invocable commands are found', async () => {
    vi.mocked(searchLibrary.searchCommandsByKeywords).mockReturnValue({
      commands: [],
      recommendation: 'Use workbook XML editing instead.',
    });

    const result = await getResult({ keywords: ['binary-only-command'] });

    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.recommendation).toBe('Use workbook XML editing instead.');
  });
});

async function getResult({ keywords }: { keywords: string[] }): Promise<CallToolResult> {
  const tool = getSearchCommandsTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ keywords }, getMockRequestHandlerExtra());
}
