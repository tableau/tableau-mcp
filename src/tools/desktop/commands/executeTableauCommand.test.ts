import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { ArgsValidationError, DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getExecuteTableauCommandTool } from './executeTableauCommand.js';

const SESSION = 'session-1';
const LIVE_UNDERLYING_METADATA_XML = `<workbook>
  <datasources><datasource name='ds' /></datasources>
  <worksheets><worksheet name='A' /><worksheet name='B' /></worksheets>
</workbook>`;
const STALE_UNDERLYING_METADATA_XML = `<workbook>
  <datasources><datasource name='ds' /></datasources>
  <worksheets><worksheet name='A' /></worksheets>
</workbook>`;

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

  it('should return error for an unknown command before resolving an executor', async () => {
    const extra = getMockRequestHandlerExtra();
    extra.getExecutor = vi.fn();

    const result = await getResult({ session: SESSION, command: 'tabdoc:not-a-command' }, extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Unknown Tableau command "tabdoc:not-a-command"');
    expect(result.content[0].text).toContain('Did you mean:');
    expect(extra.getExecutor).not.toHaveBeenCalled();
  });

  it('should return error for a crash-prone command before resolving an executor', async () => {
    const extra = getMockRequestHandlerExtra();
    extra.getExecutor = vi.fn();

    const result = await getResult(
      { session: SESSION, command: 'tabdoc:show-parameter-controls' },
      extra,
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      'Refusing to execute crash-prone Tableau command "tabdoc:show-parameter-controls".',
    );
    expect(extra.getExecutor).not.toHaveBeenCalled();
  });

  it('should call executeCommand with parsed namespace and command', async () => {
    const executeCommand = vi.fn().mockResolvedValue(new Ok({ command_id: 'c1', result: null }));
    const extra = makeExtra(executeCommand);

    // Live-verified /v0 contract (2026-07-19): goto-sheet takes "Sheet"; the bundled
    // reference's WindowLocator is wrong at runtime (500 + blocking modal).
    await getResult(
      { session: SESSION, command: 'tabdoc:goto-sheet', args: { Sheet: 'Sheet1' } },
      extra,
    );

    expect(extra.getExecutor).toHaveBeenCalledWith(SESSION);
    expect(executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'tabdoc',
        command: 'goto-sheet',
        args: { Sheet: 'Sheet1' },
      }),
    );
  });

  it('should return success with result JSON when command produces data', async () => {
    const commandResult = { some_key: 'some_value' };
    const executeCommand = vi
      .fn()
      .mockResolvedValue(new Ok({ command_id: 'c1', result: commandResult }));
    const extra = makeExtra(executeCommand);

    const result = await getResult({ session: SESSION, command: 'tabdoc:save' }, extra);

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Command executed successfully');
    expect(result.content[0].text).toContain('some_value');
  });

  it('should return success with fallback message when result is null', async () => {
    const executeCommand = vi.fn().mockResolvedValue(new Ok({ command_id: 'c1', result: null }));
    const extra = makeExtra(executeCommand);

    const result = await getResult({ session: SESSION, command: 'tabdoc:save' }, extra);

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

    // "Sheet" is the live-verified param for goto-sheet; provide it so the param guard
    // lets this call through to the (mocked) failing executor, per this test's intent.
    const result = await getResult(
      { session: SESSION, command: 'tabdoc:goto-sheet', args: { Sheet: 'Sheet1' } },
      extra,
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(new DesktopCommandExecutionError(commandError).message);
  });

  it('should default args to empty object when not provided', async () => {
    const executeCommand = vi.fn().mockResolvedValue(new Ok({ command_id: 'c1', result: null }));
    const extra = makeExtra(executeCommand);

    await getResult({ session: SESSION, command: 'tabdoc:save' }, extra);

    expect(executeCommand).toHaveBeenCalledWith(expect.objectContaining({ args: {} }));
  });

  it('should accept tabui namespace', async () => {
    const executeCommand = vi.fn().mockResolvedValue(new Ok({ command_id: 'c1', result: null }));
    const extra = makeExtra(executeCommand);

    const result = await getResult({ session: SESSION, command: 'tabui:export-theme' }, extra);

    expect(result.isError).toBeFalsy();
    expect(executeCommand).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: 'tabui', command: 'export-theme' }),
    );
  });

  describe('param-contract guard', () => {
    it('rejects goto-sheet called with an invalid param key before resolving an executor (the live-incident shape)', async () => {
      const extra = getMockRequestHandlerExtra();
      extra.getExecutor = vi.fn();

      // THE live-incident shape (2026-07-19, twice): {"WindowLocator": ...} → 500 +
      // blocking modal 47BF7751. The reference DECLARES WindowLocator required, but the
      // /v0 runtime accepts "Sheet" — the guard's live-override encodes the runtime truth.
      const result = await getResult(
        { session: SESSION, command: 'tabdoc:goto-sheet', args: { WindowLocator: 'Sheet1' } },
        extra,
      );

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(
        'Unknown parameter(s) for Tableau command "tabdoc:goto-sheet": WindowLocator',
      );
      expect(result.content[0].text).toContain('"Sheet"');
      expect(extra.getExecutor).not.toHaveBeenCalled();
    });

    it('accepts goto-sheet called with its correct required param', async () => {
      const executeCommand = vi.fn().mockResolvedValue(new Ok({ command_id: 'c1', result: null }));
      const extra = makeExtra(executeCommand);

      const result = await getResult(
        { session: SESSION, command: 'tabdoc:goto-sheet', args: { Sheet: 'Sheet1' } },
        extra,
      );

      expect(result.isError).toBeFalsy();
      expect(executeCommand).toHaveBeenCalled();
    });

    it('rejects a missing required param before resolving an executor', async () => {
      const extra = getMockRequestHandlerExtra();
      extra.getExecutor = vi.fn();

      const result = await getResult(
        { session: SESSION, command: 'tabdoc:goto-sheet', args: {} },
        extra,
      );

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(
        'Missing required parameter(s) for Tableau command "tabdoc:goto-sheet": Sheet',
      );
      expect(extra.getExecutor).not.toHaveBeenCalled();
    });

    it('gives a stricter message for an unknown param key on an opens_blocking_dialog command', async () => {
      const extra = getMockRequestHandlerExtra();
      extra.getExecutor = vi.fn();

      const result = await getResult(
        { session: SESSION, command: 'tabui:copy-sheet-image-u-i', args: { SheetName: 'Sheet1' } },
        extra,
      );

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(
        'Unknown parameter(s) for Tableau command "tabui:copy-sheet-image-u-i"',
      );
      expect(result.content[0].text).toContain('opens_blocking_dialog=true');
      expect(result.content[0].text).toContain(
        "pops a blocking modal error dialog on the user's screen",
      );
      expect(extra.getExecutor).not.toHaveBeenCalled();
    });

    it('lets generate-viz-from-notional-spec pass through with its NotionalSpecJson/ClearSheet args', async () => {
      const executeCommand = vi.fn().mockResolvedValue(new Ok({ command_id: 'c1', result: null }));
      const extra = makeExtra(executeCommand);

      const result = await getResult(
        {
          session: SESSION,
          command: 'tabdoc:generate-viz-from-notional-spec',
          args: {
            NotionalSpecJson:
              '{"version":"0.2.0","chart":"bar","fields":[{"caption":"Region","data":"string","type":"discrete","role":"dimension","encoding":"x"},{"caption":"Sales","data":"number","type":"continuous","role":"measure","aggregation":"sum","encoding":"y"}]}',
            ClearSheet: true,
          },
        },
        extra,
      );

      expect(result.isError).toBeFalsy();
      expect(executeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: 'tabdoc',
          command: 'generate-viz-from-notional-spec',
          args: {
            NotionalSpecJson:
              '{"version":"0.2.0","chart":"bar","fields":[{"caption":"Region","data":"string","type":"discrete","role":"dimension","encoding":"x"},{"caption":"Sales","data":"number","type":"continuous","role":"measure","aggregation":"sum","encoding":"y"}]}',
            ClearSheet: true,
          },
        }),
      );
    });

    it('leaves an arbitrary valid command call untouched', async () => {
      const executeCommand = vi.fn().mockResolvedValue(new Ok({ command_id: 'c1', result: null }));
      const extra = makeExtra(executeCommand);

      const result = await getResult(
        { session: SESSION, command: 'tabdoc:delete-sheet', args: { Sheet: 'Sheet1' } },
        extra,
      );

      expect(result.isError).toBeFalsy();
      expect(executeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: 'tabdoc',
          command: 'delete-sheet',
          args: { Sheet: 'Sheet1' },
        }),
      );
    });
  });

  describe('underlying metadata guard', () => {
    it('rejects a stale whole-document load before dispatching it', async () => {
      const executeCommand = vi.fn(async (params: any) => {
        if (params.command === 'save-underlying-metadata') {
          return new Ok({
            command_id: 'save-1',
            parsedResult: { text: LIVE_UNDERLYING_METADATA_XML },
          });
        }
        return new Ok({ command_id: 'load-1', result: null });
      });
      const extra = makeExtra(executeCommand);

      const result = await getResult(
        {
          session: SESSION,
          command: 'tabui:load-underlying-metadata',
          args: { text: STALE_UNDERLYING_METADATA_XML },
        },
        extra,
      );

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('DROP worksheet(s) B');
      expect(executeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: 'tabui',
          command: 'save-underlying-metadata',
          args: {},
        }),
      );
      expect(
        executeCommand.mock.calls.some(([params]) => params.command === 'load-underlying-metadata'),
      ).toBe(false);
    });

    it('fails open and dispatches when the live document fetch fails', async () => {
      const executeCommand = vi.fn(async (params: any) => {
        if (params.command === 'save-underlying-metadata') {
          return {
            isErr: (): boolean => true,
            error: { type: 'command-timed-out' as const, error: 'Timeout' },
          };
        }
        return new Ok({ command_id: 'load-1', result: null });
      });
      const extra = makeExtra(executeCommand);

      const result = await getResult(
        {
          session: SESSION,
          command: 'tabui:load-underlying-metadata',
          args: { text: LIVE_UNDERLYING_METADATA_XML },
        },
        extra,
      );

      expect(result.isError).toBeFalsy();
      expect(executeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: 'tabui',
          command: 'load-underlying-metadata',
          args: { text: LIVE_UNDERLYING_METADATA_XML },
        }),
      );
    });
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
