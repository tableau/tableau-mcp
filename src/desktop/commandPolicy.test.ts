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
});
