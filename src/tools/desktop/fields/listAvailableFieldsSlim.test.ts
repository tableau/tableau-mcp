import {
  filterListAvailableFieldsSlimByLuid,
  projectListAvailableFieldsSlim,
} from './listAvailableFieldsSlim.js';

const baseField = {
  datasource: 'Sample - Superstore',
  columnName: '[Profit]',
  columnInstanceName: '[sum:Profit:qk]',
  derivation: 'Sum',
  type: 'quantitative',
  role: 'measure',
  datatype: 'real',
  caption: 'Profit',
  isAggregated: false,
  column_ref: '[Sample - Superstore].[sum:Profit:qk]',
};

describe('listAvailableFieldsSlim', () => {
  it('projects only insight-compatible candidates into compact tuples', () => {
    const fields = [
      baseField,
      {
        ...baseField,
        columnName: '[Calculation_123]',
        caption: 'Profit Ratio',
        isAggregated: true,
      },
      {
        ...baseField,
        columnName: '[Order Date]',
        caption: 'Order Date',
        derivation: 'None',
        type: 'ordinal',
        role: 'dimension',
        datatype: 'date',
      },
      {
        ...baseField,
        columnName: '[Category]',
        caption: 'Category',
        derivation: 'None',
        type: 'nominal',
        role: 'dimension',
        datatype: 'string',
      },
      {
        ...baseField,
        columnName: '[Text Measure]',
        caption: 'Text Measure',
        datatype: 'string',
      },
    ] as any;

    expect(projectListAvailableFieldsSlim(fields)).toEqual({
      datasources: [
        {
          datasource: 'Sample - Superstore',
          measures: [
            ['Profit', 'Profit', 'Sum', 'base'],
            ['Profit Ratio', 'Calculation_123', 'User', 'aggregatedCalc'],
          ],
          timeDimensions: [['Order Date', 'Order Date', 'date']],
          breakdownDimensions: [['Category', 'Category', 'nominal']],
        },
      ],
    });
  });

  it('resolves modern workbook datasource IDs before friendly-name fallback', () => {
    const result = filterListAvailableFieldsSlimByLuid({
      result: projectListAvailableFieldsSlim([
        { ...baseField, datasource: 'federated.abc123' },
      ] as any),
      workbookDatasources: [
        {
          id: 'federated.abc123',
          name: 'Published Superstore',
          caption: 'Sample - Superstore',
          luid: 'luid-superstore',
        },
        {
          name: 'federated.abc123',
          luid: 'luid-friendly-collision',
        },
      ],
      luids: [],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw result.error;
    expect(result.value.datasources).toEqual([
      expect.objectContaining({
        datasource: 'federated.abc123',
        name: 'Sample - Superstore',
        luid: 'luid-superstore',
      }),
    ]);
  });

  it('falls back to an exact unique workbook datasource name or caption', () => {
    const result = filterListAvailableFieldsSlimByLuid({
      result: projectListAvailableFieldsSlim([baseField] as any),
      workbookDatasources: [
        {
          name: 'Published Superstore',
          caption: 'Sample - Superstore',
          luid: 'luid-superstore',
        },
      ],
      luids: [],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw result.error;
    expect(result.value.datasources[0]).toMatchObject({
      name: 'Sample - Superstore',
      luid: 'luid-superstore',
    });
  });

  it('rejects a published and embedded datasource sharing a fallback identity', () => {
    const result = filterListAvailableFieldsSlimByLuid({
      result: projectListAvailableFieldsSlim([baseField] as any),
      workbookDatasources: [
        { name: 'Sample - Superstore', luid: null },
        { caption: 'Sample - Superstore', luid: 'luid-published' },
      ],
      luids: [],
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) throw new Error('Expected an ambiguity error');
    expect(result.error.message).toContain('matched multiple workbook datasources');
    expect(result.error.message).toContain('<no LUID>, luid-published');
  });

  it('does not let a requested LUID relabel an ambiguous field group', () => {
    const result = filterListAvailableFieldsSlimByLuid({
      result: projectListAvailableFieldsSlim([baseField] as any),
      workbookDatasources: [
        { name: 'Sample - Superstore', luid: null },
        { caption: 'Sample - Superstore', luid: 'luid-published' },
      ],
      luids: ['luid-published'],
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) throw new Error('Expected an ambiguity error');
    expect(result.error.message).toContain('matched multiple workbook datasources');
  });

  it('ignores unrelated ambiguity for a targeted LUID', () => {
    const result = filterListAvailableFieldsSlimByLuid({
      result: projectListAvailableFieldsSlim([
        baseField,
        { ...baseField, datasource: 'Finance', columnName: '[Revenue]', caption: 'Revenue' },
      ] as any),
      workbookDatasources: [
        { name: 'Sample - Superstore', luid: 'luid-one' },
        { caption: 'Sample - Superstore', luid: 'luid-two' },
        { name: 'Finance', luid: 'luid-finance' },
      ],
      luids: ['luid-finance'],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw result.error;
    expect(result.value.datasources).toEqual([
      expect.objectContaining({ datasource: 'Finance', luid: 'luid-finance' }),
    ]);
  });

  it('reports requested LUIDs that have no matching field group', () => {
    const result = filterListAvailableFieldsSlimByLuid({
      result: projectListAvailableFieldsSlim([baseField] as any),
      workbookDatasources: [{ name: 'Sample - Superstore', luid: 'luid-superstore' }],
      luids: ['luid-missing'],
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) throw new Error('Expected a missing-LUID error');
    expect(result.error.message).toContain('No workbook datasource fields matched LUIDs');
    expect(result.error.message).toContain('luid-missing');
  });

  it('reports a total datasource identity mismatch instead of returning an empty success', () => {
    const result = filterListAvailableFieldsSlimByLuid({
      result: projectListAvailableFieldsSlim([
        { ...baseField, datasource: 'federated.abc123' },
      ] as any),
      workbookDatasources: [
        {
          id: 'wb-ds-superstore',
          name: 'Published Superstore',
          caption: 'Superstore',
          luid: 'luid-superstore',
        },
      ],
      luids: [],
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) throw new Error('Expected an identity-mismatch error');
    expect(result.error.message).toContain('Could not match workbook field datasource identities');
    expect(result.error.message).toContain('federated.abc123');
    expect(result.error.message).toContain('wb-ds-superstore');
  });

  it('does not treat an empty LUID as LUID-backed', () => {
    const result = filterListAvailableFieldsSlimByLuid({
      result: projectListAvailableFieldsSlim([baseField] as any),
      workbookDatasources: [{ name: 'Sample - Superstore', luid: '' }],
      luids: [],
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw result.error;
    expect(result.value).toEqual({ datasources: [] });
  });
});
