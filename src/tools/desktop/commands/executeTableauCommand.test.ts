import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Ok } from 'ts-results-es';

import { _resetExternalApiCommandRegistryForTest } from '../../../desktop/externalApi/commandRegistry.js';
import * as discoveryModule from '../../../desktop/externalApi/discovery.js';
import { ArgsValidationError, DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getExecuteTableauCommandTool } from './executeTableauCommand.js';

vi.mock('../../../desktop/externalApi/discovery.js');

const SESSION = 'session-1';
const SORT_NESTED_LIVE_500_FIX =
  'FIX: tabdoc:sort-nested is known to fail (HTTP 500) on current Desktop builds regardless of parameters — do not retry it. Sort instead via the bind-template sort proposal (preferred for template-bound sheets) or the workbook document round-trip (get-workbook-xml → edit the computed-sort → apply-workbook).';
const TEST_REGISTRY_DIRS: string[] = [];

function makeExtra(
  executeCommandImpl: (...args: any[]) => any,
): ReturnType<typeof getMockRequestHandlerExtra> {
  const extra = getMockRequestHandlerExtra();
  extra.getExecutor = vi.fn().mockResolvedValue({
    executeCommand: vi.fn().mockImplementation(executeCommandImpl),
    getWorkbookDocument: vi.fn(),
  });
  return extra;
}

function writeExternalApiRegistry({
  commands,
  typeOfParam = {},
  enumVals = {},
}: {
  commands: Record<string, unknown>;
  typeOfParam?: Record<string, unknown>;
  enumVals?: Record<string, string[]>;
}): string {
  const dir = mkdtempSync(join(process.cwd(), 'external-api-registry-test-'));
  TEST_REGISTRY_DIRS.push(dir);
  writeFileSync(join(dir, 'command_param_registry.json'), JSON.stringify(commands), 'utf-8');
  writeFileSync(
    join(dir, 'codegen_registry.json'),
    JSON.stringify({ param_name: {}, type_of_param: typeOfParam, enum_vals: enumVals }),
    'utf-8',
  );
  return dir;
}

function enableExternalApiRegistry(commands: Record<string, unknown>): void {
  const dir = writeExternalApiRegistry({
    commands,
    typeOfParam: { DPI_ShowMeCommandType: { enum_name: 'ShowMeCommandType' } },
    enumVals: { ShowMeCommandType: ['bars', 'lines'] },
  });
  vi.stubEnv('EXTERNAL_API_REGISTRY_DIR', dir);
  _resetExternalApiCommandRegistryForTest();
}

describe('executeTableauCommandTool', () => {
  beforeEach(() => {
    vi.mocked(discoveryModule.discoverInstances).mockReturnValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    _resetExternalApiCommandRegistryForTest();
    for (const dir of TEST_REGISTRY_DIRS.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

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
    const payload = JSON.parse(result.content[0].text);
    expect(payload.message).toContain('Command executed successfully');
    expect(payload.result).toEqual(commandResult);
  });

  it('truncates oversized command result payloads with an honest byte-count note', async () => {
    const largeValue = 'x'.repeat(20 * 1024);
    const executeCommand = vi
      .fn()
      .mockResolvedValue(new Ok({ command_id: 'c1', result: { largeValue } }));
    const extra = makeExtra(executeCommand);

    const result = await getResult({ session: SESSION, command: 'tabdoc:save' }, extra);

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.message).toContain('result truncated:');
    expect(payload.message).toContain('re-run with a narrower command if you need the rest');
    expect(payload.result).not.toContain(largeValue);
    expect(Buffer.byteLength(result.content[0].text, 'utf-8')).toBeLessThan(18 * 1024);
  });

  it('returns isError=true when command output serialization failed', async () => {
    const executeCommand = vi.fn().mockResolvedValue(
      new Ok({
        command_id: 'c1',
        result: { ok: true },
        warnings: [
          {
            code: 'output-serialization-failed',
            message: 'Command output could not be serialized.',
          },
        ],
      }),
    );
    const extra = makeExtra(executeCommand);

    const result = await getResult({ session: SESSION, command: 'tabdoc:save' }, extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.message).toContain(
      'Command executed, but the requested result cannot be returned',
    );
    expect(payload.message).toContain(
      'WARNING: output-serialization-failed - Command output could not be serialized.',
    );
    expect(payload.message).not.toContain('Command executed successfully');
    expect(payload.warnings).toEqual([
      {
        code: 'output-serialization-failed',
        message: 'Command output could not be serialized.',
      },
    ]);
  });

  it('is silent about missing output when a command succeeds without result data', async () => {
    const executeCommand = vi.fn().mockResolvedValue(new Ok({ command_id: 'c1', result: null }));
    const extra = makeExtra(executeCommand);

    const result = await getResult({ session: SESSION, command: 'tabdoc:save' }, extra);

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.message).toBe('Command executed successfully.');
    expect(payload.result).toBeUndefined();
    expect(payload.message).not.toContain('no result data');
  });

  it('surfaces command failure message and tableau-error-code extension', async () => {
    const commandError = {
      type: 'command-failed' as const,
      error: {
        code: 'ERR',
        message: 'Desktop reported the real failure',
        recoverable: false,
        'tableau-error-code': '0x1234',
      },
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
    expect(result.content[0].text).toBe(
      'Desktop reported the real failure\ntableau-error-code: 0x1234',
    );
    expect(result.content[0].text).not.toContain('Command execution failed');
  });

  it('appends the known-live failure fix when mapped command execution fails', async () => {
    const commandError = {
      type: 'command-failed' as const,
      error: { code: 'ERR', message: 'live 500', recoverable: false },
    };
    const executeCommand = vi.fn().mockResolvedValue({ isErr: () => true, error: commandError });
    const extra = makeExtra(executeCommand);

    const result = await getResult(
      {
        session: SESSION,
        command: 'tabdoc:sort-nested',
        args: {
          DimensionToSort: '[Sample - Superstore].[Category]',
          Worksheet: 'Sheet 1',
          MeasureName: '[Sample - Superstore].[Sales]',
          ShelfType: 'rows',
        },
      },
      extra,
    );

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(
      new DesktopCommandExecutionError(commandError).message,
    );
    expect(result.content[0].text).toContain(SORT_NESTED_LIVE_500_FIX);
  });

  it('does not append the known-live failure fix when mapped command execution succeeds', async () => {
    const executeCommand = vi.fn().mockResolvedValue(new Ok({ command_id: 'c1', result: null }));
    const extra = makeExtra(executeCommand);

    const result = await getResult(
      {
        session: SESSION,
        command: 'tabdoc:sort-nested',
        args: {
          DimensionToSort: '[Sample - Superstore].[Category]',
          Worksheet: 'Sheet 1',
          MeasureName: '[Sample - Superstore].[Sales]',
          ShelfType: 'rows',
        },
      },
      extra,
    );

    expect(result.isError).toBeFalsy();
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).not.toContain('FIX:');
    expect(result.content[0].text).not.toContain(SORT_NESTED_LIVE_500_FIX);
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

    it('rejects tabdoc:sort before resolving an executor because it drives a blocking dialog', async () => {
      const extra = getMockRequestHandlerExtra();
      extra.getExecutor = vi.fn();

      const result = await getResult(
        {
          session: SESSION,
          command: 'tabdoc:sort',
          args: {
            FieldName: '[Sample - Superstore].[Category]',
            Worksheet: 'Sheet 1',
            Type: 'SortType::Computed',
            MeasureName: '[Sample - Superstore].[Sales]',
          },
        },
        extra,
      );

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(
        'tabdoc:sort drives a UI dialog and blocks the screen',
      );
      expect(result.content[0].text).toContain('refine-worksheet with operation sort_by_field');
      expect(result.content[0].text).toContain('bind-template sort proposal/document round-trip');
      expect(extra.getExecutor).not.toHaveBeenCalled();
    });

    it('rejects tabdoc:sort-nested missing required params before resolving an executor', async () => {
      const extra = getMockRequestHandlerExtra();
      extra.getExecutor = vi.fn();

      const result = await getResult(
        {
          session: SESSION,
          command: 'tabdoc:sort-nested',
          args: {
            DimensionToSort: '[Sample - Superstore].[Category]',
            Worksheet: 'Sheet 1',
          },
        },
        extra,
      );

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(
        'Missing required parameter(s) for Tableau command "tabdoc:sort-nested": MeasureName, ShelfType',
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

    it('does not inspect the workbook after generate-viz-from-notional-spec succeeds', async () => {
      const executeCommand = vi
        .fn()
        .mockResolvedValue(new Ok({ command_id: 'generate-1', result: null }));
      const extra = makeExtra(executeCommand);

      const result = await getResult(
        {
          session: SESSION,
          command: 'tabdoc:generate-viz-from-notional-spec',
          args: {
            NotionalSpecJson:
              '{"version":"0.2.0","chart":"bar","fields":[{"caption":"Region","data":"string","type":"discrete","role":"dimension","encoding":"x"},{"caption":"Revenue","data":"number","type":"continuous","role":"measure","aggregation":"sum","encoding":"y"}]}',
            ClearSheet: true,
          },
        },
        extra,
      );

      expect(result.isError).toBeFalsy();
      invariant(result.content[0].type === 'text');
      expect(JSON.parse(result.content[0].text).message).toBe('Command executed successfully.');
      expect(executeCommand).toHaveBeenCalledTimes(1);
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

  describe('external API command registry guard', () => {
    const SHOW_ME_REGISTRY_ENTRY = {
      agent_can_invoke: true,
      opens_blocking_dialog: false,
      modifies_state: 'false',
      in_params: [
        {
          local: 'WorksheetName',
          type: 'DPI_Worksheet',
          required: true,
          wire: 'worksheet',
        },
        {
          local: 'ShowMeType',
          type: 'DPI_ShowMeCommandType',
          required: true,
          wire: 'show-me-command-type',
        },
      ],
    };

    it('keeps existing behavior when EXTERNAL_API_REGISTRY_DIR is unset', async () => {
      const executeCommand = vi.fn().mockResolvedValue(new Ok({ command_id: 'c1', result: null }));
      const extra = makeExtra(executeCommand);

      const result = await getResult(
        {
          session: SESSION,
          command: 'tabdoc:show-me',
          args: { WorksheetName: 'Sheet 1', ShowMeType: 'bars' },
        },
        extra,
      );

      expect(result.isError).toBeFalsy();
      expect(executeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          args: { WorksheetName: 'Sheet 1', ShowMeType: 'bars' },
        }),
      );
    });

    it('refuses commands marked not invocable before resolving an executor', async () => {
      enableExternalApiRegistry({
        'tabdoc:show-me': {
          ...SHOW_ME_REGISTRY_ENTRY,
          agent_can_invoke: false,
        },
      });
      const extra = getMockRequestHandlerExtra();
      extra.getExecutor = vi.fn();

      const result = await getResult(
        {
          session: SESSION,
          command: 'tabdoc:show-me',
          args: { WorksheetName: 'Sheet 1', ShowMeType: 'bars' },
        },
        extra,
      );

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('agent_can_invoke=false');
      expect(result.content[0].text).toContain('human-blocking dialog');
      expect(extra.getExecutor).not.toHaveBeenCalled();
    });

    it('refuses live-observed dialog commands before resolving an executor', async () => {
      enableExternalApiRegistry({
        'tabui:workgroup-change-site': {
          agent_can_invoke: true,
          opens_blocking_dialog: false,
          modifies_state: 'false',
          in_params: [],
        },
      });
      const extra = getMockRequestHandlerExtra();
      extra.getExecutor = vi.fn();

      const result = await getResult(
        { session: SESSION, command: 'tabui:workgroup-change-site', args: {} },
        extra,
      );

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('human-blocking dialog');
      expect(result.content[0].text).toContain('switch sites in Desktop');
      expect(extra.getExecutor).not.toHaveBeenCalled();
    });

    it('refuses live-observed dialog commands whenever a valid registry is enabled', async () => {
      enableExternalApiRegistry({ 'tabdoc:show-me': SHOW_ME_REGISTRY_ENTRY });
      const extra = getMockRequestHandlerExtra();
      extra.getExecutor = vi.fn();

      const result = await getResult(
        { session: SESSION, command: 'tabui:workgroup-change-site', args: {} },
        extra,
      );

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('human-blocking dialog');
      expect(extra.getExecutor).not.toHaveBeenCalled();
    });

    it('rewrites local parameter names to their registry wire names before dispatch', async () => {
      enableExternalApiRegistry({ 'tabdoc:show-me': SHOW_ME_REGISTRY_ENTRY });
      const executeCommand = vi.fn().mockResolvedValue(new Ok({ command_id: 'c1', result: null }));
      const extra = makeExtra(executeCommand);

      const result = await getResult(
        {
          session: SESSION,
          command: 'tabdoc:show-me',
          args: { WorksheetName: 'Sheet 1', ShowMeType: 'bars' },
        },
        extra,
      );

      expect(result.isError).toBeFalsy();
      expect(executeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          args: { worksheet: 'Sheet 1', 'show-me-command-type': 'bars' },
        }),
      );
    });

    it('rejects enum values that are not legal serialized values', async () => {
      enableExternalApiRegistry({ 'tabdoc:show-me': SHOW_ME_REGISTRY_ENTRY });
      const extra = getMockRequestHandlerExtra();
      extra.getExecutor = vi.fn();

      const result = await getResult(
        {
          session: SESSION,
          command: 'tabdoc:show-me',
          args: { WorksheetName: 'Sheet 1', ShowMeType: 'pie' },
        },
        extra,
      );

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(
        'Invalid value for Tableau command "tabdoc:show-me" parameter "show-me-command-type"',
      );
      expect(result.content[0].text).toContain('Legal values: bars, lines');
      expect(extra.getExecutor).not.toHaveBeenCalled();
    });

    it('refuses missing registry-required parameters by wire name', async () => {
      enableExternalApiRegistry({ 'tabdoc:show-me': SHOW_ME_REGISTRY_ENTRY });
      const extra = getMockRequestHandlerExtra();
      extra.getExecutor = vi.fn();

      const result = await getResult(
        {
          session: SESSION,
          command: 'tabdoc:show-me',
          args: { WorksheetName: 'Sheet 1' },
        },
        extra,
      );

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(
        'Missing required parameter(s) for Tableau command "tabdoc:show-me": show-me-command-type',
      );
      expect(result.content[0].text).toContain('context-filled');
      expect(extra.getExecutor).not.toHaveBeenCalled();
    });

    it('does not require registry-required workspace params that Desktop fills from context', async () => {
      enableExternalApiRegistry({
        'tabdoc:show-metrics-indicator': {
          agent_can_invoke: true,
          opens_blocking_dialog: false,
          modifies_state: 'false',
          in_params: [
            {
              local: 'Workspace',
              type: 'UPI_Workspace',
              required: true,
              wire: 'workspace',
            },
          ],
        },
      });
      const executeCommand = vi.fn().mockResolvedValue(new Ok({ command_id: 'c1', result: null }));
      const extra = makeExtra(executeCommand);

      const result = await getResult(
        { session: SESSION, command: 'tabdoc:show-metrics-indicator', args: {} },
        extra,
      );

      expect(result.isError).toBeFalsy();
      expect(executeCommand).toHaveBeenCalledWith(
        expect.objectContaining({ namespace: 'tabdoc', command: 'show-metrics-indicator' }),
      );
    });

    it('passes through unknown registry keys and warns about the bare-500 failure mode', async () => {
      enableExternalApiRegistry({ 'tabdoc:show-me': SHOW_ME_REGISTRY_ENTRY });
      const executeCommand = vi.fn().mockResolvedValue(new Ok({ command_id: 'c1', result: null }));
      const extra = makeExtra(executeCommand);

      const result = await getResult(
        {
          session: SESSION,
          command: 'tabdoc:show-me',
          args: { WorksheetName: 'Sheet 1', ShowMeType: 'bars', TypoParam: 'oops' },
        },
        extra,
      );

      expect(result.isError).toBeFalsy();
      expect(executeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          args: { worksheet: 'Sheet 1', 'show-me-command-type': 'bars', TypoParam: 'oops' },
        }),
      );
      invariant(result.content[0].type === 'text');
      expect(JSON.parse(result.content[0].text).message).toContain(
        'key "TypoParam" is not in the command registry',
      );
      expect(JSON.parse(result.content[0].text).message).toContain('bare 500');
    });
  });

  describe('deleted command refusal', () => {
    it('rejects the deleted document load command before dispatching it', async () => {
      const executeCommand = vi
        .fn()
        .mockResolvedValue(new Ok({ command_id: 'load-1', result: null }));
      const extra = makeExtra(executeCommand);

      const result = await getResult(
        {
          session: SESSION,
          command: 'tabui:load-underlying-metadata',
          args: { text: '<workbook />' },
        },
        extra,
      );

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(
        'Unknown Tableau command "tabui:load-underlying-metadata"',
      );
      expect(executeCommand).not.toHaveBeenCalled();
    });

    it('still refuses the deleted document load command when the payload matches the current document', async () => {
      const executeCommand = vi
        .fn()
        .mockResolvedValue(new Ok({ command_id: 'load-1', result: null }));
      const extra = makeExtra(executeCommand);

      const result = await getResult(
        {
          session: SESSION,
          command: 'tabui:load-underlying-metadata',
          args: { text: '<workbook><worksheets><worksheet name="A" /></worksheets></workbook>' },
        },
        extra,
      );

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(
        'Unknown Tableau command "tabui:load-underlying-metadata"',
      );
      expect(executeCommand).not.toHaveBeenCalled();
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
