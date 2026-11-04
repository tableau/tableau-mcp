import { Err } from 'ts-results-es';

import { ExecuteCommandError } from '../../../desktop/externalApi/executorTypes.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getWorkbookExtensionsTool } from './getWorkbookExtensions.js';

describe('getWorkbookExtensionsTool', () => {
  it('gates discovery at External API 0.2.27', () => {
    const tool = getWorkbookExtensionsTool(new DesktopMcpServer());
    expect(tool.name).toBe('get-workbook-extensions');
    expect(tool.minApiVersion).toBe('0.2.27');
  });

  it('reports a missing route as a Desktop update and does not call another command', async () => {
    const tool = getWorkbookExtensionsTool(new DesktopMcpServer());
    const extra = getMockRequestHandlerExtra();
    const missing: ExecuteCommandError = {
      type: 'command-failed',
      error: {
        code: 'not-found',
        message: 'No route matches GET /v0/workbook/extensions',
        recoverable: false,
      },
    };
    const executor = {
      listWorkbookExtensions: vi.fn().mockResolvedValue(new Err(missing)),
    };
    extra.getExecutor = vi.fn().mockResolvedValue(executor);

    const callback = await Provider.from(tool.callback);
    const result = await callback({ session: '12345' }, extra);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain('too old');
    expect(executor.listWorkbookExtensions).toHaveBeenCalledTimes(1);
  });
});
