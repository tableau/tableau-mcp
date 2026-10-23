import { DesktopMcpServer, selectToolsForProfile } from '../../../../server.desktop.js';
import { desktopToolFactories } from '../../tools.js';

describe('native Custom Theme registration', () => {
  it('registers the theme inspection tool in the Desktop authoring profile', () => {
    const tools = desktopToolFactories.map((factory) => factory(new DesktopMcpServer()));
    const fullNames = selectToolsForProfile(tools, 'full').map(({ name }) => name);
    const dynamicNames = selectToolsForProfile(tools, 'dynamic-authoring').map(({ name }) => name);

    expect(fullNames).toContain('inspect-custom-theme');
    expect(dynamicNames).toContain('inspect-custom-theme');
  });
});
