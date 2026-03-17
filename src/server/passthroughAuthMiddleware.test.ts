import { toolNames } from '../tools/toolName';
import { getRequiredApiScopesForTool } from './oauth/scopes';

describe('passthroughAuthMiddleware', () => {
  it('disallow passthrough auth when calling a tool without API scopes ', () => {
    const toolsWithoutMcpScopes = toolNames.filter(
      (tool) => getRequiredApiScopesForTool(tool).length === 0,
    );

    expect(
      toolsWithoutMcpScopes,
      [
        'This test is designed to fail the first time a tool is added that does not require API scopes.',
        'If you see this error, and your tool indeed requires no API scopes, you must add the appropriate logic to prevent calling the tool with passthrough auth.',
        'See: https://github.com/tableau/tableau-mcp/pull/241/changes#r2942474421',
      ].join('\n'),
    ).toHaveLength(0);
  });
});
