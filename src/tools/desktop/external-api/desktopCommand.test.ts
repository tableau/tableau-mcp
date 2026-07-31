import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import * as sessionResolution from '../../../desktop/sessionResolution.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getDesktopCommandTool } from './desktopCommand.js';

vi.mock('../../../desktop/sessionResolution.js');

describe('getDesktopCommandTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionResolution.resolveSession).mockReturnValue(Ok('999'));
  });

  it('is a mutating tool named desktop-command exposing undo and redo', () => {
    const tool = getDesktopCommandTool(new DesktopMcpServer());

    expect(tool.name).toBe('desktop-command');
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: false });
    const command = (tool.paramsSchema as { command: { options: string[] } }).command;
    expect(new Set(command.options)).toEqual(new Set(['undo', 'redo']));
  });

  it('runs undo through the executor and reports the terminal status', async () => {
    const undo = vi
      .fn()
      .mockResolvedValue(Ok({ command_id: 'op-1', status: 'completed', submitted_at: 'now' }));
    const result = await run({ command: 'undo' }, { undo });

    expect(undo).toHaveBeenCalledOnce();
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(JSON.parse(result.content[0].text)).toEqual({ command: 'undo', status: 'completed' });
  });

  it('runs redo through the executor', async () => {
    const redo = vi
      .fn()
      .mockResolvedValue(Ok({ command_id: 'op-2', status: 'completed', submitted_at: 'now' }));
    const result = await run({ command: 'redo' }, { redo });

    expect(redo).toHaveBeenCalledOnce();
    expect(result.isError).toBe(false);
  });

  it('surfaces an executor command failure as a Desktop command execution error', async () => {
    const error = {
      type: 'command-failed' as const,
      error: { code: 'nothing-to-undo', message: 'Nothing to undo', recoverable: false },
    };
    const result = await run({ command: 'undo' }, { undo: vi.fn().mockResolvedValue(Err(error)) });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(error).message);
  });
});

async function run(
  args: { command: 'undo' | 'redo' },
  executorMethods: Partial<Pick<ExternalApiToolExecutor, 'undo' | 'redo'>>,
): Promise<CallToolResult> {
  const tool = getDesktopCommandTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = {
    ...getMockRequestHandlerExtra(),
    getExecutor: vi.fn().mockResolvedValue(executorMethods as ExternalApiToolExecutor),
  };
  return await callback({ session: undefined, ...args }, extra);
}
