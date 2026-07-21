import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

const TEST_DIRS: string[] = [];

function writeRegistry({
  commands,
  typeOfParam = {},
  enumVals = {},
}: {
  commands: Record<string, unknown>;
  typeOfParam?: Record<string, unknown>;
  enumVals?: Record<string, string[]>;
}): string {
  const dir = mkdtempSync(join(process.cwd(), 'external-api-registry-test-'));
  TEST_DIRS.push(dir);
  writeFileSync(join(dir, 'command_param_registry.json'), JSON.stringify(commands), 'utf-8');
  writeFileSync(
    join(dir, 'codegen_registry.json'),
    JSON.stringify({ param_name: {}, type_of_param: typeOfParam, enum_vals: enumVals }),
    'utf-8',
  );
  return dir;
}

describe('externalApi commandRegistry', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of TEST_DIRS.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when EXTERNAL_API_REGISTRY_DIR is unset', async () => {
    const { lookupExternalApiCommandRegistry } = await import('./commandRegistry.js');

    expect(lookupExternalApiCommandRegistry('tabdoc', 'show-me')).toBeNull();
  });

  it('returns null when a registry file is corrupt', async () => {
    const dir = mkdtempSync(join(process.cwd(), 'external-api-registry-test-'));
    TEST_DIRS.push(dir);
    writeFileSync(join(dir, 'command_param_registry.json'), '{not-json', 'utf-8');
    writeFileSync(
      join(dir, 'codegen_registry.json'),
      JSON.stringify({ param_name: {}, type_of_param: {}, enum_vals: {} }),
      'utf-8',
    );
    vi.stubEnv('EXTERNAL_API_REGISTRY_DIR', dir);

    const { lookupExternalApiCommandRegistry } = await import('./commandRegistry.js');

    expect(lookupExternalApiCommandRegistry('tabdoc', 'show-me')).toBeNull();
  });

  it('loads command params, wire aliases, and enum values from synthetic registries', async () => {
    const dir = writeRegistry({
      commands: {
        'tabdoc:show-me': {
          agent_can_invoke: true,
          opens_blocking_dialog: false,
          modifies_state: 'false',
          in_params: [
            {
              local: 'ShowMeType',
              type: 'DPI_ShowMeCommandType',
              required: true,
              wire: 'show-me-command-type',
            },
            {
              local: 'WorksheetName',
              type: 'DPI_Worksheet',
              required: true,
              wire: 'worksheet',
            },
          ],
        },
      },
      typeOfParam: {
        DPI_ShowMeCommandType: { enum_name: 'ShowMeCommandType' },
        DPI_TupleEnumType: ['TupleEnum', 'enum'],
      },
      enumVals: {
        ShowMeCommandType: ['bars', 'lines'],
      },
    });
    vi.stubEnv('EXTERNAL_API_REGISTRY_DIR', dir);

    const { lookupExternalApiCommandRegistry } = await import('./commandRegistry.js');
    const entry = lookupExternalApiCommandRegistry('tabdoc', 'show-me');

    expect(entry).not.toBeNull();
    expect(entry?.invocable).toBe(true);
    expect(entry?.blockingDialog).toBe(false);
    expect(entry?.requiredParams.map((param) => param.wire)).toEqual([
      'show-me-command-type',
      'worksheet',
    ]);
    expect(entry?.paramWireByLocal.get('ShowMeType')).toBe('show-me-command-type');
    expect(entry?.paramWireByCamelToDashed.get('show-me-type')).toBe('show-me-command-type');
    expect(entry?.enumValuesForParamType.get('DPI_ShowMeCommandType')).toEqual(['bars', 'lines']);
  });

  it('resolves enum names from tuple-shaped type_of_param entries (the shipped registry shape)', async () => {
    const dir = writeRegistry({
      commands: {
        'tabdoc:show-me': {
          agent_can_invoke: true,
          opens_blocking_dialog: false,
          in_params: [
            {
              local: 'ShowMeType',
              type: 'DPI_TupleEnumType',
              required: true,
              wire: 'show-me-command-type',
            },
          ],
        },
      },
      typeOfParam: { DPI_TupleEnumType: ['TupleEnum', 'enum'] },
      enumVals: { TupleEnum: ['bar-horiz', 'text'] },
    });
    vi.stubEnv('EXTERNAL_API_REGISTRY_DIR', dir);

    const { lookupExternalApiCommandRegistry } = await import('./commandRegistry.js');
    const entry = lookupExternalApiCommandRegistry('tabdoc', 'show-me');

    expect(entry?.enumValuesForParamType.get('DPI_TupleEnumType')).toEqual(['bar-horiz', 'text']);
  });

  it('parses the files once for a stable env dir', async () => {
    const dir = writeRegistry({
      commands: {
        'tabdoc:show-me': {
          agent_can_invoke: true,
          opens_blocking_dialog: false,
          modifies_state: 'false',
          in_params: [],
        },
      },
    });
    vi.stubEnv('EXTERNAL_API_REGISTRY_DIR', dir);

    const { lookupExternalApiCommandRegistry } = await import('./commandRegistry.js');
    expect(lookupExternalApiCommandRegistry('tabdoc', 'show-me')?.invocable).toBe(true);

    writeFileSync(
      join(dir, 'command_param_registry.json'),
      JSON.stringify({
        'tabdoc:show-me': {
          agent_can_invoke: false,
          opens_blocking_dialog: false,
          modifies_state: 'false',
          in_params: [],
        },
      }),
      'utf-8',
    );

    expect(lookupExternalApiCommandRegistry('tabdoc', 'show-me')?.invocable).toBe(true);
  });
});
