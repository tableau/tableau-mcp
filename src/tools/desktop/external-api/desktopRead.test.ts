import { DesktopMcpServer } from '../../../server.desktop.js';
import { getDesktopReadTool } from './desktopRead.js';

describe('getDesktopReadTool', () => {
  it('is a read-only tool named desktop-read', () => {
    const tool = getDesktopReadTool(new DesktopMcpServer());

    expect(tool.name).toBe('desktop-read');
    expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
  });

  it('exposes every shipped environment/inspection read as a method', () => {
    const tool = getDesktopReadTool(new DesktopMcpServer());
    const method = (tool.paramsSchema as { method: { options: string[] } }).method;

    expect(new Set(method.options)).toEqual(
      new Set([
        'health',
        'api-root',
        'app-info',
        'site',
        'site-workbooks',
        'storyboards',
        'worksheet-info',
        'dashboard-info',
        'storyboard-info',
        'storyboard-document',
      ]),
    );
  });
});
