import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import { _resetExternalApiCommandRegistryForTest } from '../externalApi/commandRegistry.js';
import { guardCommand } from './externalApiCommandGuard.js';

const TEST_REGISTRY_DIRS: string[] = [];

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

function writeExternalApiRegistry({
  commands,
  typeOfParam = {},
  enumVals = {},
}: {
  commands: Record<string, unknown>;
  typeOfParam?: Record<string, unknown>;
  enumVals?: Record<string, string[]>;
}): string {
  const dir = mkdtempSync(join(process.cwd(), 'external-api-guard-test-'));
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

describe('guardCommand', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    _resetExternalApiCommandRegistryForTest();
    for (const dir of TEST_REGISTRY_DIRS.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses an unknown command before consulting the External API registry', () => {
    enableExternalApiRegistry({
      'tabdoc:not-a-command': {
        ...SHOW_ME_REGISTRY_ENTRY,
        agent_can_invoke: false,
        opens_blocking_dialog: true,
      },
    });

    const result = guardCommand({
      namespace: 'tabdoc',
      cmd: 'not-a-command',
      command: 'tabdoc:not-a-command',
      args: { WorksheetName: 'Sheet 1', ShowMeType: 'bars' },
    });

    expect('refused' in result).toBe(true);
    if (!('refused' in result)) return;
    expect(result.message).toContain('Unknown Tableau command "tabdoc:not-a-command"');
    expect(result.message).not.toContain('human-blocking dialog');
    expect(result.message).not.toContain('agent_can_invoke=false');
  });

  it('applies the unconditional dialog blocklist before registry-backed refusal reasons', () => {
    enableExternalApiRegistry({
      'tabui:workgroup-change-site': {
        agent_can_invoke: false,
        opens_blocking_dialog: true,
        modifies_state: 'false',
        in_params: [],
      },
    });

    const result = guardCommand({
      namespace: 'tabui',
      cmd: 'workgroup-change-site',
      command: 'tabui:workgroup-change-site',
      args: {},
    });

    expect('refused' in result).toBe(true);
    if (!('refused' in result)) return;
    expect(result.message).toContain('live-observed dialog-popper');
    expect(result.message).toContain('switch sites in Desktop');
    expect(result.message).not.toContain('agent_can_invoke=false');
    expect(result.message).not.toContain('opens_blocking_dialog=true');
  });

  it('refuses raw goto-sheet even when a safe External API registry entry exists', () => {
    enableExternalApiRegistry({
      'tabdoc:goto-sheet': {
        agent_can_invoke: true,
        opens_blocking_dialog: false,
        modifies_state: 'false',
        in_params: [{ local: 'Sheet', type: 'DPI_Worksheet', required: true, wire: 'sheet' }],
      },
    });

    const result = guardCommand({
      namespace: 'tabdoc',
      cmd: 'goto-sheet',
      command: 'tabdoc:goto-sheet',
      args: { Sheet: 'Missing Sheet' },
    });

    expect('refused' in result).toBe(true);
    if (!('refused' in result)) return;
    expect(result.message).toContain('activate-sheet');
    expect(result.message).toContain('"sheetName"');
    expect(result.message).toContain('cannot pre-validate');
    expect(result.message).toContain(
      'An invalid sheet value can open a blocking Tableau Desktop dialog',
    );
    expect(result.message).toContain('47BF7751');
    expect(result.message).not.toContain('because it would open');
  });

  it('rewrites registry local parameter names to wire names and returns registry warnings', () => {
    enableExternalApiRegistry({ 'tabdoc:show-me': SHOW_ME_REGISTRY_ENTRY });

    const result = guardCommand({
      namespace: 'tabdoc',
      cmd: 'show-me',
      command: 'tabdoc:show-me',
      args: { WorksheetName: 'Sheet 1', ShowMeType: 'bars', TypoParam: 'oops' },
    });

    expect('ok' in result).toBe(true);
    if (!('ok' in result)) return;
    expect(result.dispatchArgs).toEqual({
      worksheet: 'Sheet 1',
      'show-me-command-type': 'bars',
      TypoParam: 'oops',
    });
    expect(result.warnings).toEqual([
      'WARNING: key "TypoParam" is not in the command registry - a wrong name surfaces as a bare 500.',
    ]);
  });

  it('fails open to the bundled param-contract guard when the registry is unavailable', () => {
    const result = guardCommand({
      namespace: 'tabdoc',
      cmd: 'show-me',
      command: 'tabdoc:show-me',
      args: { WorksheetName: 'Sheet 1', ShowMeType: 'bars' },
    });

    expect('ok' in result).toBe(true);
    if (!('ok' in result)) return;
    expect(result.dispatchArgs).toEqual({ WorksheetName: 'Sheet 1', ShowMeType: 'bars' });
    expect(result.warnings).toEqual([]);
  });
});
