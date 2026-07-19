const mocks = vi.hoisted(() => ({
  readDataAsset: vi.fn(),
}));

vi.mock('./assets.js', () => ({
  readDataAsset: mocks.readDataAsset,
}));

const REFERENCE = {
  commands: [
    { fully_qualified_serialized_name: 'tabdoc:save' },
    { fully_qualified_serialized_name: 'tabdoc:save-as' },
    { fully_qualified_serialized_name: 'tabdoc:goto-sheet' },
    { fully_qualified_serialized_name: 'tabui:export-theme' },
  ],
};

describe('commandRegistry', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.readDataAsset.mockReset();
  });

  it('loads fully qualified command names from the bundled reference', async () => {
    mocks.readDataAsset.mockReturnValue(JSON.stringify(REFERENCE));
    const { knownCommands } = await import('./commandRegistry.js');

    expect(knownCommands()).toEqual(
      new Set(['tabdoc:save', 'tabdoc:save-as', 'tabdoc:goto-sheet', 'tabui:export-theme']),
    );
  });

  it('fails open when the bundled reference is unreadable', async () => {
    mocks.readDataAsset.mockReturnValue(null);
    const { validateKnownCommand } = await import('./commandRegistry.js');

    expect(validateKnownCommand('tabdoc:not-in-reference')).toEqual({ ok: true });
  });

  it('fails open when the bundled reference is malformed', async () => {
    mocks.readDataAsset.mockReturnValue('{not json');
    const { validateKnownCommand } = await import('./commandRegistry.js');

    expect(validateKnownCommand('tabdoc:not-in-reference')).toEqual({ ok: true });
  });

  it('refuses crash-prone commands even when the reference is unreadable', async () => {
    mocks.readDataAsset.mockReturnValue(null);
    const { validateKnownCommand } = await import('./commandRegistry.js');

    expect(validateKnownCommand('tabdoc:show-parameter-controls')).toEqual({
      ok: false,
      message: 'Refusing to execute crash-prone Tableau command "tabdoc:show-parameter-controls".',
    });
  });

  it('refuses unknown commands with up to three did-you-mean suggestions', async () => {
    mocks.readDataAsset.mockReturnValue(JSON.stringify(REFERENCE));
    const { validateKnownCommand } = await import('./commandRegistry.js');

    expect(validateKnownCommand('tabdoc:svae')).toEqual({
      ok: false,
      message:
        'Unknown Tableau command "tabdoc:svae". Did you mean: tabdoc:save, tabdoc:save-as, tabdoc:goto-sheet?',
    });
  });

  it('allows commands present in the bundled reference', async () => {
    mocks.readDataAsset.mockReturnValue(JSON.stringify(REFERENCE));
    const { validateKnownCommand } = await import('./commandRegistry.js');

    expect(validateKnownCommand('tabui:export-theme')).toEqual({ ok: true });
  });
});
