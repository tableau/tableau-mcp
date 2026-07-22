const mocks = vi.hoisted(() => ({
  readDataAsset: vi.fn(),
}));

vi.mock('./assets.js', () => ({
  readDataAsset: mocks.readDataAsset,
}));

const REFERENCE = {
  commands: [
    {
      fully_qualified_serialized_name: 'tabdoc:mock-goto',
      opens_blocking_dialog: false,
      parameters: [
        {
          direction: 'in',
          local_name: 'WindowLocator',
          required: true,
          comment: 'locator for the window',
        },
        { direction: 'out', local_name: 'ConnectionAttemptInfo', required: false },
      ],
    },
    {
      fully_qualified_serialized_name: 'tabui:copy-sheet-image-u-i',
      opens_blocking_dialog: true,
      parameters: [
        { direction: 'in', local_name: 'Sheet', required: true, comment: 'sheet to copy' },
      ],
    },
    {
      fully_qualified_serialized_name: 'tabdoc:save',
      opens_blocking_dialog: false,
      parameters: [],
    },
    {
      fully_qualified_serialized_name: 'tabdoc:generate-viz-from-notional-spec',
      opens_blocking_dialog: false,
      parameters: [],
    },
    {
      fully_qualified_serialized_name: 'tabdoc:delete-sheet',
      opens_blocking_dialog: false,
      parameters: [
        { direction: 'in', local_name: 'Sheet', required: true, comment: 'Target sheet' },
        {
          direction: 'in',
          local_name: 'DeleteOrphans',
          required: false,
          comment: 'Delete orphans',
        },
      ],
    },
  ],
};

describe('paramContractGuard', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.readDataAsset.mockReset();
  });

  it('rejects a known command called with an unknown param key, naming the key and the valid ones', async () => {
    mocks.readDataAsset.mockReturnValue(JSON.stringify(REFERENCE));
    const { validateCommandParams } = await import('./paramContractGuard.js');

    // The live incident's shape: goto-sheet's only "in" param is WindowLocator, not Sheet.
    const result = validateCommandParams('tabdoc:mock-goto', { Sheet: 'Sheet 1' });

    expect(result).toEqual({
      ok: false,
      message:
        'Unknown parameter(s) for Tableau command "tabdoc:mock-goto": Sheet. NOT sent, to avoid a Tableau ' +
        'Desktop parameter-error dialog. Valid "in" params: WindowLocator (required: true) - locator for the ' +
        'window. FIX: use one of the valid param names above.',
    });
  });

  it('accepts goto-sheet called with its correct required param', async () => {
    mocks.readDataAsset.mockReturnValue(JSON.stringify(REFERENCE));
    const { validateCommandParams } = await import('./paramContractGuard.js');

    expect(validateCommandParams('tabdoc:mock-goto', { WindowLocator: 'Sheet 1' })).toEqual({
      ok: true,
    });
  });

  it('rejects a missing required param, naming it', async () => {
    mocks.readDataAsset.mockReturnValue(JSON.stringify(REFERENCE));
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
    mocks.readDataAsset.mockReturnValue(JSON.stringify(REFERENCE));
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
    mocks.readDataAsset.mockReturnValue(JSON.stringify(REFERENCE));
    const { validateCommandParams } = await import('./paramContractGuard.js');

    const result = validateCommandParams('tabui:copy-sheet-image-u-i', {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('Missing required parameter(s)');
      expect(result.message).toContain('opens_blocking_dialog=true');
    }
  });

  it('skips the unknown-key check for a command with zero declared "in" params', async () => {
    mocks.readDataAsset.mockReturnValue(JSON.stringify(REFERENCE));
    const { validateCommandParams } = await import('./paramContractGuard.js');

    // generate-viz-from-notional-spec's contract has no declared "in" params (pane-invoked
    // commands are dropped by the reference's extraction pass) — the deeper NotionalSpec
    // payload guard validates its actual shape, not this generic key check.
    expect(
      validateCommandParams('tabdoc:generate-viz-from-notional-spec', {
        NotionalSpecJson: '{}',
        ClearSheet: true,
      }),
    ).toEqual({ ok: true });
  });

  it('leaves an arbitrary valid command call untouched', async () => {
    mocks.readDataAsset.mockReturnValue(JSON.stringify(REFERENCE));
    const { validateCommandParams } = await import('./paramContractGuard.js');

    expect(
      validateCommandParams('tabdoc:delete-sheet', { Sheet: 'Sheet 1', DeleteOrphans: true }),
    ).toEqual({
      ok: true,
    });
    expect(validateCommandParams('tabdoc:save', {})).toEqual({ ok: true });
  });

  it('fails open when the command has no entry in the reference', async () => {
    mocks.readDataAsset.mockReturnValue(JSON.stringify(REFERENCE));
    const { validateCommandParams } = await import('./paramContractGuard.js');

    expect(validateCommandParams('tabdoc:not-in-reference', { anything: 'goes' })).toEqual({
      ok: true,
    });
  });

  it('fails open when the bundled reference is unreadable', async () => {
    mocks.readDataAsset.mockReturnValue(null);
    const { validateCommandParams } = await import('./paramContractGuard.js');

    expect(validateCommandParams('tabdoc:mock-goto', { Sheet: 'Sheet 1' })).toEqual({ ok: true });
  });

  it('fails open when the bundled reference is malformed', async () => {
    mocks.readDataAsset.mockReturnValue('{not json');
    const { validateCommandParams } = await import('./paramContractGuard.js');

    expect(validateCommandParams('tabdoc:mock-goto', { Sheet: 'Sheet 1' })).toEqual({ ok: true });
  });

  it('treats undefined args the same as an empty object', async () => {
    mocks.readDataAsset.mockReturnValue(JSON.stringify(REFERENCE));
    const { validateCommandParams } = await import('./paramContractGuard.js');

    const result = validateCommandParams('tabdoc:mock-goto', undefined);
    expect(result.ok).toBe(false);
  });
});

describe('raw goto-sheet refusal', () => {
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

  it('refuses goto-sheet even when the bundled reference is unreadable', async () => {
    const { validateCommandParams } = await import('./paramContractGuard.js');
    mocks.readDataAsset.mockImplementation(() => {
      throw new Error('unreadable');
    });
    const result = validateCommandParams('tabdoc:goto-sheet', { Sheet: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('activate-sheet');
    }
  });
});

describe('live dialog policy refusals', () => {
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
      expect(result.message).toContain('bind-template sort proposal/document round-trip');
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
