import { DesktopMcpServer, selectToolsForProfile } from '../../../../server.desktop.js';
import { desktopToolFactories } from '../../tools.js';

describe('native Custom Theme registration', () => {
  it('registers apply-workbook-style only in the full profile', () => {
    const tools = desktopToolFactories.map((factory) => factory(new DesktopMcpServer()));
    const fullNames = selectToolsForProfile(tools, 'full').map(({ name }) => name);
    const dynamicNames = selectToolsForProfile(tools, 'dynamic-authoring').map(({ name }) => name);

    expect(fullNames).toContain('apply-workbook-style');
    expect(dynamicNames).not.toContain('apply-workbook-style');
  });
});
