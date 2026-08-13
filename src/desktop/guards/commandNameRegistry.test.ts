import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import { _resetExternalApiCommandRegistryForTest } from '../externalApi/paramWireRegistry.js';

const TEST_REGISTRY_DIRS: string[] = [];

const COMMAND_NAMES = ['tabdoc:save', 'tabdoc:save-as', 'tabdoc:goto-sheet', 'tabui:export-theme'];

function commandParamRegistryFixture(names: string[]): Record<string, unknown> {
  return Object.fromEntries(
    names.map((name) => [
      name,
      { agent_can_invoke: true, opens_blocking_dialog: false, in_params: [] },
    ]),
  );
}

function enableExternalApiRegistry(names: string[]): void {
  const dir = mkdtempSync(join(process.cwd(), 'command-name-registry-test-'));
  TEST_REGISTRY_DIRS.push(dir);
  writeFileSync(
    join(dir, 'command_param_registry.json'),
    JSON.stringify(commandParamRegistryFixture(names)),
    'utf-8',
  );
  writeFileSync(join(dir, 'codegen_registry.json'), JSON.stringify({}), 'utf-8');
  vi.stubEnv('EXTERNAL_API_REGISTRY_DIR', dir);
  _resetExternalApiCommandRegistryForTest();
}

describe('commandNameRegistry', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    _resetExternalApiCommandRegistryForTest();
    for (const dir of TEST_REGISTRY_DIRS.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loads fully qualified command names from the External API registry', async () => {
    enableExternalApiRegistry(COMMAND_NAMES);
    const { knownCommands } = await import('./commandNameRegistry.js');

    expect(knownCommands()).toEqual(new Set(COMMAND_NAMES));
  });

  it('fails open when the External API registry is not configured', async () => {
    const { validateKnownCommand } = await import('./commandNameRegistry.js');

    expect(validateKnownCommand('tabdoc:not-in-registry')).toEqual({ ok: true });
  });

  it('fails open when the External API registry is unreadable', async () => {
    vi.stubEnv('EXTERNAL_API_REGISTRY_DIR', join(process.cwd(), 'does-not-exist-registry-dir'));
    _resetExternalApiCommandRegistryForTest();
    const { validateKnownCommand } = await import('./commandNameRegistry.js');

    expect(validateKnownCommand('tabdoc:not-in-registry')).toEqual({ ok: true });
  });

  it('refuses crash-prone commands even when the registry is unconfigured', async () => {
    const { validateKnownCommand } = await import('./commandNameRegistry.js');

    expect(validateKnownCommand('tabdoc:show-parameter-controls')).toEqual({
      ok: false,
      message: 'Refusing to execute crash-prone Tableau command "tabdoc:show-parameter-controls".',
    });
  });

  it('refuses unknown commands with up to three did-you-mean suggestions', async () => {
    enableExternalApiRegistry(COMMAND_NAMES);
    const { validateKnownCommand } = await import('./commandNameRegistry.js');

    expect(validateKnownCommand('tabdoc:svae')).toEqual({
      ok: false,
      message:
        'Unknown Tableau command "tabdoc:svae". Did you mean: tabdoc:save, tabdoc:save-as, tabdoc:goto-sheet?',
    });
  });

  it('allows commands present in the External API registry', async () => {
    enableExternalApiRegistry(COMMAND_NAMES);
    const { validateKnownCommand } = await import('./commandNameRegistry.js');

    expect(validateKnownCommand('tabui:export-theme')).toEqual({ ok: true });
  });

  it('allows a command the registry declares even though a bundled snapshot never would', async () => {
    // The regression this whole migration fixes: a command Desktop already ships
    // (e.g. tabdoc:add-local-extension) must pass the name guard as soon as the
    // live registry knows about it, with no dependency on any bundled JSON.
    enableExternalApiRegistry([...COMMAND_NAMES, 'tabdoc:add-local-extension']);
    const { validateKnownCommand } = await import('./commandNameRegistry.js');

    expect(validateKnownCommand('tabdoc:add-local-extension')).toEqual({ ok: true });
  });
});
