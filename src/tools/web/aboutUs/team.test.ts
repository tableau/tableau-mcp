import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getAboutTheTeamTool } from './team.js';

describe('aboutTheTeamTool', () => {
  it('should create a tool instance with correct properties', async () => {
    const tool = getAboutTheTeamTool(new WebMcpServer());
    const annotations = await Provider.from(tool.annotations);
    expect(tool.name).toBe('about-the-team');
    expect(annotations?.readOnlyHint).toBe(true);
    expect(annotations?.destructiveHint).toBe(false);
    expect(annotations?.idempotentHint).toBe(true);
    expect(annotations?.openWorldHint).toBe(false);
  });

  it.each([
    ['Yogi', 'Hello, I am Yogi. I like cricket and music'],
    ['Stephen', 'Hello, I am Stephen. I like frogs, rock music, and sunny weather'],
    ['Jaehun', 'Hello, I am Jaehun. I like hiking and skiing'],
  ] as const)('returns the blurb for %s', async (teamMember, expected) => {
    const tool = getAboutTheTeamTool(new WebMcpServer());
    const result = (await tool.callback({ teamMember }, getMockRequestHandlerExtra())) as
      | CallToolResult
      | undefined;
    expect(result?.isError).toBe(false);
    expect(result?.content?.[0]).toEqual({ type: 'text', text: JSON.stringify(expected) });
  });
});
