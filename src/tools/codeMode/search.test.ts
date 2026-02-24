import { exportedForTesting as serverExportedForTesting } from '../../server.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';

import { getCodeModeSearchTool } from './search.js';

vi.mock('./common.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./common.js')>();
  return {
    ...actual,
    executeCodeMode: vi.fn().mockResolvedValue({
      isError: false,
      content: [{ type: 'text', text: '{"ok":true}' }],
    }),
  };
});

import { executeCodeMode } from './common.js';

const { Server } = serverExportedForTesting;

describe('codeMode search tool', () => {
  it('delegates to executeCodeMode with invocations disabled', async () => {
    const server = new Server();
    const tool = getCodeModeSearchTool(server);
    const extra = getMockRequestHandlerExtra();

    await tool.callback({ code: 'async () => []' }, extra);

    expect(executeCodeMode).toHaveBeenCalledWith(
      expect.objectContaining({
        allowInvocations: false,
        code: 'async () => []',
      }),
    );
  });
});
