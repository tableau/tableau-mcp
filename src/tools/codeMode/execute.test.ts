import { exportedForTesting as serverExportedForTesting } from '../../server.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';

import { getCodeModeExecuteTool } from './execute.js';

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

describe('codeMode execute tool', () => {
  it('delegates to executeCodeMode with invocations enabled', async () => {
    const server = new Server();
    const tool = getCodeModeExecuteTool(server);
    const extra = getMockRequestHandlerExtra();

    await tool.callback({ code: 'async () => "done"' }, extra);

    expect(executeCodeMode).toHaveBeenCalledWith(
      expect.objectContaining({
        allowInvocations: true,
        code: 'async () => "done"',
      }),
    );
  });
});
