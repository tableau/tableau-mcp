import { DesktopMcpServer } from '../../../server.desktop.js';
import { getWorkbookExtensionsTool } from './getWorkbookExtensions.js';

describe('getWorkbookExtensionsTool', () => {
  it('declares its name', () => {
    const tool = getWorkbookExtensionsTool(new DesktopMcpServer());
    expect(tool.name).toBe('get-workbook-extensions');
  });
});
