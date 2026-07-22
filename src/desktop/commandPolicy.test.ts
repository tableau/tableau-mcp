describe('commandPolicy', () => {
  it('keeps sort-nested as one policy record with both live params and the do-not-retry hint', async () => {
    const { checkCommandPolicy } = await import('./commandPolicy.js');

    const policy = checkCommandPolicy('tabdoc:sort-nested');

    expect(policy).toMatchObject({
      action: 'hint',
      reason: 'known-live-failure',
    });
    expect(policy?.fix).toContain('known to fail');
    expect(policy?.fix).toContain('do not retry');
    expect(policy?.fix).toContain('bind-template sort proposal');
    expect(policy?.params?.required).toEqual(
      new Set(['DimensionToSort', 'Worksheet', 'MeasureName', 'ShelfType']),
    );
    expect(policy?.params?.allowed).toContain('KeepFieldFilters');
  });

  it('removes the old exported crash-prone table from commandRegistry', async () => {
    const commandRegistry = await import('./commandRegistry.js');

    expect(commandRegistry).not.toHaveProperty('CRASH_PRONE_COMMANDS');
  });

  it('limits the unvalidated-target refusal to the exact raw goto-sheet command', async () => {
    const { unvalidatedTargetPolicyFor } = await import('./commandPolicy.js');

    expect(unvalidatedTargetPolicyFor('tabdoc:goto-sheet')).toMatchObject({
      action: 'refuse',
      reason: 'unvalidated-target',
    });
    expect(unvalidatedTargetPolicyFor('tabdoc:basic-goto-sheet')).toBeUndefined();
    expect(unvalidatedTargetPolicyFor('tabdoc:goto-sheet-like-command')).toBeUndefined();
  });
});
