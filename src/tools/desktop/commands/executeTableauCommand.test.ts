import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { ArgsValidationError, DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getExecuteTableauCommandTool } from './executeTableauCommand.js';

const SESSION = 'session-1';

function makeExtra(
  executeCommandImpl: (...args: any[]) => any,
): ReturnType<typeof getMockRequestHandlerExtra> {
  const extra = getMockRequestHandlerExtra();
  extra.getExecutor = vi.fn().mockResolvedValue({
    executeCommand: vi.fn().mockImplementation(executeCommandImpl),
  });
  return extra;
}

describe('executeTableauCommandTool', () => {
  it('should create a tool instance with correct properties', () => {
    const tool = getExecuteTableauCommandTool(new DesktopMcpServer());
    expect(tool.name).toBe('execute-tableau-command');
    expect(tool.description).toContain('namespace:command');
    expect(tool.paramsSchema).toMatchObject({
      session: expect.any(Object),
      command: expect.any(Object),
      args: expect.any(Object),
    });
    expect(tool.annotations).toMatchObject({ readOnlyHint: false });
  });

  it('should return error for command missing a colon separator', async () => {
    const extra = getMockRequestHandlerExtra();
    const result = await getResult({ session: SESSION, command: 'invalidformat' }, extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      new ArgsValidationError(
        "Invalid command format. Expected 'namespace:command' (e.g., 'tabdoc:goto-sheet'), got: invalidformat",
      ).message,
    );
  });

  it('should return error for an unrecognised namespace', async () => {
    const extra = getMockRequestHandlerExtra();
    const result = await getResult({ session: SESSION, command: 'badns:some-cmd' }, extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Invalid namespace "badns"');
  });

  it('should call executeCommand with parsed namespace and command', async () => {
    const executeCommand = vi.fn().mockResolvedValue(new Ok({ command_id: 'c1', result: null }));
    const extra = makeExtra(executeCommand);

    await getResult(
      { session: SESSION, command: 'tabdoc:goto-sheet', args: { sheet: 'Sheet1' } },
      extra,
    );

    expect(extra.getExecutor).toHaveBeenCalledWith(SESSION);
    expect(executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'tabdoc',
        command: 'goto-sheet',
        args: { sheet: 'Sheet1' },
      }),
    );
  });

  it('should return success with result JSON when command produces data', async () => {
    const commandResult = { some_key: 'some_value' };
    const executeCommand = vi
      .fn()
      .mockResolvedValue(new Ok({ command_id: 'c1', result: commandResult }));
    const extra = makeExtra(executeCommand);

    const result = await getResult({ session: SESSION, command: 'tabui:save-workbook' }, extra);

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Command executed successfully');
    expect(result.content[0].text).toContain('some_value');
  });

  it('should return success with fallback message when result is null', async () => {
    const executeCommand = vi.fn().mockResolvedValue(new Ok({ command_id: 'c1', result: null }));
    const extra = makeExtra(executeCommand);

    const result = await getResult({ session: SESSION, command: 'tabui:save-workbook' }, extra);

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('no result data');
  });

  it('should return error when executeCommand fails', async () => {
    const commandError = {
      type: 'command-failed' as const,
      error: { code: 'ERR', message: 'fail', recoverable: false },
    };
    const executeCommand = vi.fn().mockResolvedValue({ isErr: () => true, error: commandError });
    const extra = makeExtra(executeCommand);

    const result = await getResult({ session: SESSION, command: 'tabdoc:goto-sheet' }, extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(commandError).message);
  });

  it('should default args to empty object when not provided', async () => {
    const executeCommand = vi.fn().mockResolvedValue(new Ok({ command_id: 'c1', result: null }));
    const extra = makeExtra(executeCommand);

    await getResult({ session: SESSION, command: 'tabui:save-workbook' }, extra);

    expect(executeCommand).toHaveBeenCalledWith(expect.objectContaining({ args: {} }));
  });

  it('should accept tabui namespace', async () => {
    const executeCommand = vi.fn().mockResolvedValue(new Ok({ command_id: 'c1', result: null }));
    const extra = makeExtra(executeCommand);

    const result = await getResult({ session: SESSION, command: 'tabui:save-workbook' }, extra);

    expect(result.isError).toBeFalsy();
    expect(executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: 'tabui', command: 'save-workbook' }),
    );
  });
});

async function getResult(
  { session, command, args }: { session: string; command: string; args?: Record<string, unknown> },
  extra: ReturnType<typeof getMockRequestHandlerExtra>,
): Promise<CallToolResult> {
  const tool = getExecuteTableauCommandTool(new DesktopMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({ session, command, args }, extra);
}
