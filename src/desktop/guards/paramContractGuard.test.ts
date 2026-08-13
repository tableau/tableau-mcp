import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import { _resetExternalApiCommandRegistryForTest } from '../externalApi/paramWireRegistry.js';
import { _resetCommandsReferenceForTest } from './commandsReference.js';

const TEST_DIRS: string[] = [];

// The registry synthesis this guard reads from carries no per-param "comment"/description
// (tab-agent-south's live command_param_registry.json has none today — see commandsReference.ts),
// so formatParam's optional " - <comment>" suffix never appears in messages built from it.
const REGISTRY: Record<string, unknown> = {
  'tabdoc:mock-goto': {
    agent_can_invoke: true,
    opens_blocking_dialog: false,
    modifies_state: 'false',
    in_params: [
      { local: 'WindowLocator', type: 'DPI_WindowLocator', required: true, wire: 'window-locator' },
    ],
  },
  'tabui:copy-sheet-image-u-i': {
    agent_can_invoke: true,
    opens_blocking_dialog: true,
    modifies_state: 'false',
    in_params: [{ local: 'Sheet', type: 'DPI_SheetName', required: true, wire: 'sheet' }],
  },
  'tabdoc:save': {
    agent_can_invoke: true,
    opens_blocking_dialog: false,
    modifies_state: 'true',
    in_params: [],
  },
  'tabdoc:generate-viz-from-notional-spec': {
    agent_can_invoke: true,
    opens_blocking_dialog: false,
    modifies_state: 'true',
    in_params: [],
  },
  'tabdoc:delete-sheet': {
    agent_can_invoke: true,
    opens_blocking_dialog: false,
    modifies_state: 'true',
    in_params: [
      { local: 'Sheet', type: 'DPI_SheetName', required: true, wire: 'sheet' },
      {
        local: 'DeleteOrphans',
        type: 'DPI_DeleteOrphans',
        required: false,
        wire: 'delete-orphans',
      },
    ],
  },
};

function enableExternalApiRegistry(commands: Record<string, unknown>): void {
  const dir = mkdtempSync(join(process.cwd(), 'param-contract-guard-test-'));
  TEST_DIRS.push(dir);
  writeFileSync(join(dir, 'command_param_registry.json'), JSON.stringify(commands), 'utf-8');
  writeFileSync(join(dir, 'codegen_registry.json'), JSON.stringify({}), 'utf-8');
  vi.stubEnv('EXTERNAL_API_REGISTRY_DIR', dir);
  _resetExternalApiCommandRegistryForTest();
  _resetCommandsReferenceForTest();
}

function resetRegistryFixture(): void {
  vi.unstubAllEnvs();
  _resetExternalApiCommandRegistryForTest();
  _resetCommandsReferenceForTest();
  for (const dir of TEST_DIRS.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

// paramContractGuard.ts memoises its own commandsByName() projection at module scope, on top
// of commandsReference.ts's and paramWireRegistry.ts's own caches — resetModules is the only
// way to force it to re-derive from a freshly (un)stubbed EXTERNAL_API_REGISTRY_DIR every test.
beforeEach(() => {
  vi.resetModules();
});

describe('paramContractGuard', () => {
  beforeEach(() => {
    enableExternalApiRegistry(REGISTRY);
  });

  afterEach(() => {
    resetRegistryFixture();
  });

  it('rejects a known command called with an unknown param key, naming the key and the valid ones', async () => {
    const { validateCommandParams } = await import('./paramContractGuard.js');

    // The live incident's shape: goto-sheet's only "in" param is WindowLocator, not Sheet.
    const result = validateCommandParams('tabdoc:mock-goto', { Sheet: 'Sheet 1' });

    expect(result).toEqual({
      ok: false,
      message:
        'Unknown parameter(s) for Tableau command "tabdoc:mock-goto": Sheet. NOT sent, to avoid a Tableau ' +
        'Desktop parameter-error dialog. Valid "in" params: WindowLocator (required: true). ' +
        'FIX: use one of the valid param names above.',
    });
  });

  it('accepts goto-sheet called with its correct required param', async () => {
    const { validateCommandParams } = await import('./paramContractGuard.js');

    expect(validateCommandParams('tabdoc:mock-goto', { WindowLocator: 'Sheet 1' })).toEqual({
      ok: true,
    });
  });

  it('rejects a missing required param, naming it', async () => {
    const { validateCommandParams } = await import('./paramContractGuard.js');

    const result = validateCommandParams('tabdoc:mock-goto', {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(
        'Missing required parameter(s) for Tableau command "tabdoc:mock-goto"',
      );
      expect(result.message).toContain('WindowLocator');
    }
  });

  it('gives a stricter message for an unknown param on an opens_blocking_dialog command', async () => {
    const { validateCommandParams } = await import('./paramContractGuard.js');

    const result = validateCommandParams('tabui:copy-sheet-image-u-i', { SheetName: 'Sheet 1' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(
        'Unknown parameter(s) for Tableau command "tabui:copy-sheet-image-u-i"',
      );
      expect(result.message).toContain('opens_blocking_dialog=true');
      expect(result.message).toContain("pops a blocking modal error dialog on the user's screen");
    }
  });

  it('gives a stricter message for a missing required param on an opens_blocking_dialog command', async () => {
    const { validateCommandParams } = await import('./paramContractGuard.js');

    const result = validateCommandParams('tabui:copy-sheet-image-u-i', {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('Missing required parameter(s)');
      expect(result.message).toContain('opens_blocking_dialog=true');
    }
  });

  it('skips the unknown-key check for a command with zero declared "in" params', async () => {
    const { validateCommandParams } = await import('./paramContractGuard.js');

    // generate-viz-from-notional-spec's contract has no declared "in" params (pane-invoked
    // commands are dropped by tab-agent-south's extraction pass) — the deeper NotionalSpec
    // payload guard validates its actual shape, not this generic key check.
    expect(
      validateCommandParams('tabdoc:generate-viz-from-notional-spec', {
        NotionalSpecJson: '{}',
        ClearSheet: true,
      }),
    ).toEqual({ ok: true });
  });

  it('leaves an arbitrary valid command call untouched', async () => {
    const { validateCommandParams } = await import('./paramContractGuard.js');

    expect(
      validateCommandParams('tabdoc:delete-sheet', { Sheet: 'Sheet 1', DeleteOrphans: true }),
    ).toEqual({
      ok: true,
    });
    expect(validateCommandParams('tabdoc:save', {})).toEqual({ ok: true });
  });

  it('fails open when the command has no entry in the registry', async () => {
    const { validateCommandParams } = await import('./paramContractGuard.js');

    expect(validateCommandParams('tabdoc:not-in-registry', { anything: 'goes' })).toEqual({
      ok: true,
    });
  });

  it('treats undefined args the same as an empty object', async () => {
    const { validateCommandParams } = await import('./paramContractGuard.js');

    const result = validateCommandParams('tabdoc:mock-goto', undefined);
    expect(result.ok).toBe(false);
  });
});

describe('paramContractGuard with no External API registry loaded', () => {
  afterEach(() => {
    resetRegistryFixture();
  });

  it('fails open on every command when EXTERNAL_API_REGISTRY_DIR is unset', async () => {
    const { validateCommandParams } = await import('./paramContractGuard.js');

    expect(validateCommandParams('tabdoc:mock-goto', { Sheet: 'Sheet 1' })).toEqual({ ok: true });
  });

  it('fails open when the External API registry directory is unreadable', async () => {
    vi.stubEnv('EXTERNAL_API_REGISTRY_DIR', join(process.cwd(), 'does-not-exist-registry-dir'));
    _resetExternalApiCommandRegistryForTest();
    _resetCommandsReferenceForTest();
    const { validateCommandParams } = await import('./paramContractGuard.js');

    expect(validateCommandParams('tabdoc:mock-goto', { Sheet: 'Sheet 1' })).toEqual({ ok: true });
  });
});

describe('raw goto-sheet refusal', () => {
  afterEach(() => {
    resetRegistryFixture();
  });

  it('refuses goto-sheet even with "Sheet" because bad sheet values open modal 47BF7751', async () => {
    const { validateCommandParams } = await import('./paramContractGuard.js');
    const result = validateCommandParams('tabdoc:goto-sheet', { Sheet: 'Sheet 1' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('activate-sheet');
      expect(result.message).toContain('"sheetName"');
      expect(result.message).toContain('cannot pre-validate');
      expect(result.message).toContain(
        'An invalid sheet value can open a blocking Tableau Desktop dialog',
      );
      expect(result.message).toContain('47BF7751');
      expect(result.message).not.toContain('opens a BLOCKING dialog/modal');
    }
  });

  it('refuses goto-sheet with "WindowLocator" before parameter-shape validation', async () => {
    const { validateCommandParams } = await import('./paramContractGuard.js');
    const result = validateCommandParams('tabdoc:goto-sheet', { WindowLocator: 'Sheet 1' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('activate-sheet');
      expect(result.message).toContain('cannot pre-validate');
    }
  });

  it('refuses goto-sheet with no args before parameter-shape validation', async () => {
    const { validateCommandParams } = await import('./paramContractGuard.js');
    const result = validateCommandParams('tabdoc:goto-sheet', undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('activate-sheet');
      expect(result.message).toContain('cannot pre-validate');
    }
  });

  it('refuses goto-sheet even when no External API registry is loaded', async () => {
    const { validateCommandParams } = await import('./paramContractGuard.js');
    const result = validateCommandParams('tabdoc:goto-sheet', { Sheet: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('activate-sheet');
    }
  });
});

describe('live dialog policy refusals', () => {
  afterEach(() => {
    resetRegistryFixture();
  });

  it('refuses tabdoc:sort outright with the headless sort FIX', async () => {
    const { validateCommandParams } = await import('./paramContractGuard.js');
    const result = validateCommandParams('tabdoc:sort', {
      FieldName: '[Sample - Superstore].[Category]',
      Worksheet: 'Sheet 1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('tabdoc:sort drives a UI dialog and blocks the screen');
      expect(result.message).toContain('refine-worksheet with operation sort_by_field');
      expect(result.message).toContain('cached-document round-trip');
    }
  });

  it('refuses revert-workbook-ui outright with an author-forward FIX (the triple-boo modal, 2026-07-19)', async () => {
    const { validateCommandParams } = await import('./paramContractGuard.js');
    const result = validateCommandParams('tabdoc:revert-workbook-ui', { workspace: 'anything' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('BLOCKING dialog');
      expect(result.message).toContain('NOT sent');
      expect(result.message).toContain('author forward');
    }
  });

  it('refuses every dialog-misclassified command regardless of args', async () => {
    const { validateCommandParams } = await import('./paramContractGuard.js');
    for (const name of [
      'tabdoc:create-new-parameter',
      'tabdoc:edit-existing-parameter',
      'tabdoc:show-sort-dialog',
      'tabdoc:sort',
      'tabdoc:edit-filter-dialog',
      'tabdoc:show-action-list-dialog-for-worksheet',
    ]) {
      const result = validateCommandParams(name, {});
      expect(result.ok, name).toBe(false);
      if (!result.ok) {
        expect(result.message).toContain('FIX:');
      }
    }
  });
});

describe('live param overrides for sort commands', () => {
  afterEach(() => {
    resetRegistryFixture();
  });

  it('rejects sort-nested with missing required params before dispatch', async () => {
    const { validateCommandParams } = await import('./paramContractGuard.js');
    const result = validateCommandParams('tabdoc:sort-nested', {
      DimensionToSort: '[Sample - Superstore].[Category]',
      Worksheet: 'Sheet 1',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(
        'Missing required parameter(s) for Tableau command "tabdoc:sort-nested": MeasureName, ShelfType',
      );
      expect(result.message).toContain('Live-verified /v0 contract requires');
      expect(result.message).toContain('known to fail');
      expect(result.message).toContain('do not retry');
    }
  });

  it('keeps sort-nested validation-only params when its live contract is complete', async () => {
    const { validateCommandParams } = await import('./paramContractGuard.js');
    expect(
      validateCommandParams('tabdoc:sort-nested', {
        DimensionToSort: '[Sample - Superstore].[Category]',
        Worksheet: 'Sheet 1',
        MeasureName: '[Sample - Superstore].[Sales]',
        ShelfType: 'rows',
      }),
    ).toEqual({ ok: true });
  });
});
