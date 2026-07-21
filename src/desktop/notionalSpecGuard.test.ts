import { validateNotionalSpecArgs } from './notionalSpecGuard.js';

const COMMAND = 'tabdoc:generate-viz-from-notional-spec';

const EXAMPLE_1_SPEC = {
  version: '0.2.0',
  chart: 'bar',
  fields: [
    { caption: 'Region', data: 'string', type: 'discrete', role: 'dimension', encoding: 'x' },
    {
      caption: 'Sales',
      data: 'number',
      type: 'continuous',
      role: 'measure',
      aggregation: 'sum',
      encoding: 'y',
    },
  ],
  sort: { field: 'Region', by: 'Sales', aggregation: 'sum', direction: 'desc' },
};

const GOLDEN_SPECS = [
  {
    name: 'e1-bar',
    spec: {
      version: '0.2.0',
      chart: 'bar',
      fields: [
        {
          caption: 'Region',
          data: 'string',
          type: 'discrete',
          role: 'dimension',
          encoding: 'x',
        },
        {
          caption: 'Revenue',
          data: 'number',
          type: 'continuous',
          role: 'measure',
          aggregation: 'sum',
          encoding: 'y',
        },
      ],
      sort: {
        field: 'Region',
        by: 'Revenue',
        aggregation: 'sum',
        direction: 'desc',
      },
    },
  },
  {
    name: 'e2-calc-bar',
    spec: {
      version: '0.2.0',
      chart: 'bar',
      fields: [
        {
          caption: 'Rep Name',
          data: 'string',
          type: 'discrete',
          role: 'dimension',
          encoding: 'x',
        },
        {
          caption: 'Quota Attainment %',
          data: 'number',
          type: 'continuous',
          role: 'measure',
          aggregation: 'default',
          encoding: 'y',
        },
      ],
      sort: {
        field: 'Rep Name',
        by: 'Quota Attainment %',
        direction: 'desc',
      },
    },
  },
  {
    name: 'e3-kpi-text',
    spec: {
      version: '0.2.0',
      chart: 'text',
      fields: [
        {
          caption: 'ARR This Quarter',
          data: 'string',
          type: 'discrete',
          role: 'measure',
          encoding: 'text',
        },
        {
          caption: 'QoQ Change',
          data: 'string',
          type: 'discrete',
          role: 'measure',
          encoding: 'text',
        },
      ],
      categoricalFilters: [
        {
          type: 'categorical',
          field: 'Metric Name',
          values: ['ARR'],
        },
      ],
    },
  },
  {
    name: 'e4-line',
    spec: {
      version: '0.2.0',
      chart: 'line',
      fields: [
        {
          caption: 'Month Date',
          data: 'date',
          type: 'continuous',
          role: 'dimension',
          aggregation: 'month',
          encoding: 'x',
        },
        {
          caption: 'Mau',
          data: 'number',
          type: 'continuous',
          role: 'measure',
          aggregation: 'sum',
          encoding: 'y',
        },
        {
          caption: 'Product',
          data: 'string',
          type: 'discrete',
          role: 'dimension',
          encoding: 'color',
        },
      ],
    },
  },
  {
    name: 'm1-gantt',
    spec: {
      version: '0.2.0',
      chart: 'gantt',
      fields: [
        {
          caption: 'Line Item',
          data: 'string',
          type: 'discrete',
          role: 'dimension',
          encoding: 'x',
        },
        {
          caption: 'Running Total',
          data: 'number',
          type: 'continuous',
          role: 'measure',
          encoding: 'y',
        },
        {
          caption: 'Bar Size',
          data: 'number',
          type: 'continuous',
          role: 'measure',
          encoding: 'size',
        },
        {
          caption: 'Category',
          data: 'string',
          type: 'discrete',
          role: 'dimension',
          encoding: 'color',
        },
      ],
      categoricalFilters: [
        {
          type: 'categorical',
          field: 'Category',
          values: ['subtotal', 'total'],
          exclude: true,
        },
      ],
      sort: {
        field: 'Line Item',
        by: 'Display Order',
        aggregation: 'min',
        direction: 'asc',
      },
    },
  },
  {
    name: 's7-symbolmap',
    spec: {
      version: '0.2.0',
      chart: 'symbolmap',
      fields: [
        {
          caption: 'Longitude',
          data: 'number',
          type: 'continuous',
          role: 'measure',
          aggregation: 'avg',
          encoding: 'x',
        },
        {
          caption: 'Latitude',
          data: 'number',
          type: 'continuous',
          role: 'measure',
          aggregation: 'avg',
          encoding: 'y',
        },
        {
          caption: 'City',
          data: 'string',
          type: 'discrete',
          role: 'dimension',
          encoding: 'text',
        },
        {
          caption: 'PM Name',
          data: 'string',
          type: 'discrete',
          role: 'dimension',
          encoding: 'text',
        },
      ],
    },
  },
];

function expectSpecFailure(spec: object, expectedText: string): void {
  const result = validateNotionalSpecArgs(COMMAND, {
    NotionalSpecJson: JSON.stringify(spec),
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected failure');
  expect(result.message).toContain(expectedText);
  expect(result.message).toContain('FIX:');
}

describe('validateNotionalSpecArgs', () => {
  it('passes through other commands unchanged, even with arbitrary args', () => {
    expect(
      validateNotionalSpecArgs('tabdoc:goto-sheet', { WorksheetId: 'anything', mark: 'bar' }),
    ).toEqual({ ok: true });
  });

  it('accepts the doc Example 1 spec', () => {
    const result = validateNotionalSpecArgs(COMMAND, {
      NotionalSpecJson: JSON.stringify(EXAMPLE_1_SPEC),
    });
    expect(result).toEqual({ ok: true });
  });

  it('accepts Example 1 with optional ClearSheet', () => {
    const result = validateNotionalSpecArgs(COMMAND, {
      NotionalSpecJson: JSON.stringify(EXAMPLE_1_SPEC),
      ClearSheet: true,
    });
    expect(result).toEqual({ ok: true });
  });

  it.each(GOLDEN_SPECS)('accepts golden spec $name', ({ spec }) => {
    const result = validateNotionalSpecArgs(COMMAND, {
      NotionalSpecJson: JSON.stringify(spec),
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects the fabricated mark/columns/rows/title schema', () => {
    const result = validateNotionalSpecArgs(COMMAND, {
      NotionalSpecJson: JSON.stringify({
        mark: 'bar',
        columns: ['Region'],
        rows: ['Sales'],
        title: 'Sales by Region',
      }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('Unknown top-level key "mark"');
    expect(result.message).toContain('FIX:');
    expect(result.message).toContain('"version": "0.2.0"');
    expect(result.message).toContain(
      'expertise://tableau/tactics/data/dynamic-dashboard-authoring',
    );
  });

  it('rejects a worksheetName parameter', () => {
    const result = validateNotionalSpecArgs(COMMAND, {
      NotionalSpecJson: JSON.stringify(EXAMPLE_1_SPEC),
      worksheetName: 'Sheet 1',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('Unknown parameter "worksheetName"');
    expect(result.message).toContain('FIX:');
  });

  it('rejects a WorksheetId parameter with the documented-500 guidance', () => {
    const result = validateNotionalSpecArgs(COMMAND, {
      NotionalSpecJson: JSON.stringify(EXAMPLE_1_SPEC),
      WorksheetId: 'abc123',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('Unknown parameter "WorksheetId"');
    expect(result.message).toContain('500');
    expect(result.message).toContain('goto-sheet');
  });

  it('rejects a chart value outside the v0.2 enum', () => {
    const result = validateNotionalSpecArgs(COMMAND, {
      NotionalSpecJson: JSON.stringify({ ...EXAMPLE_1_SPEC, chart: 'sankey' }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('not in the v0.2 chart enum');
    expect(result.message).toContain('FIX:');
  });

  it('rejects a non-string NotionalSpecJson', () => {
    const result = validateNotionalSpecArgs(COMMAND, {
      NotionalSpecJson: { version: '0.2.0', fields: [] },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('requires "NotionalSpecJson" as a JSON string');
    expect(result.message).toContain('FIX:');
  });

  it('rejects malformed JSON in NotionalSpecJson', () => {
    const result = validateNotionalSpecArgs(COMMAND, {
      NotionalSpecJson: '{ not valid json',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('not valid JSON');
  });

  it('rejects a missing NotionalSpecJson parameter', () => {
    const result = validateNotionalSpecArgs(COMMAND, {});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('requires "NotionalSpecJson" as a JSON string');
    expect(result.message).toContain('got undefined');
  });

  it('rejects a spec missing version', () => {
    const result = validateNotionalSpecArgs(COMMAND, {
      NotionalSpecJson: JSON.stringify({ fields: [{ caption: 'Region' }] }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('missing a valid "version" string');
  });

  it('rejects a spec with an empty fields array', () => {
    const result = validateNotionalSpecArgs(COMMAND, {
      NotionalSpecJson: JSON.stringify({ version: '0.2.0', fields: [] }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('non-empty "fields" array');
  });

  it('rejects a field missing caption', () => {
    const result = validateNotionalSpecArgs(COMMAND, {
      NotionalSpecJson: JSON.stringify({
        version: '0.2.0',
        fields: [{ data: 'string', role: 'dimension' }],
      }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toContain('field at index 0 is missing a non-empty "caption"');
  });

  it('rejects a real-world payload using field aggregation none', () => {
    expectSpecFailure(
      {
        version: '0.2.0',
        chart: 'bar',
        fields: [
          {
            caption: 'Rep Name',
            data: 'string',
            type: 'discrete',
            role: 'dimension',
            encoding: 'x',
          },
          {
            caption: 'Attainment %',
            data: 'number',
            type: 'continuous',
            role: 'measure',
            aggregation: 'none',
            encoding: 'y',
          },
        ],
        sort: {
          field: 'Rep Name',
          by: 'Attainment %',
          aggregation: 'none',
          direction: 'desc',
        },
      },
      '"none" is not v0.2 vocabulary',
    );
  });

  it('rejects a real-world payload using rangeFilter max', () => {
    expectSpecFailure(
      {
        version: '0.2.0',
        chart: 'bar',
        fields: [
          {
            caption: 'Rep Name',
            data: 'string',
            type: 'discrete',
            role: 'dimension',
            encoding: 'x',
          },
          {
            caption: 'Attainment %',
            data: 'number',
            type: 'continuous',
            role: 'measure',
            aggregation: 'none',
            encoding: 'y',
          },
        ],
        rangeFilters: [{ field: 'Attainment %', aggregation: 'none', max: 1 }],
        sort: {
          field: 'Rep Name',
          by: 'Attainment %',
          aggregation: 'none',
          direction: 'desc',
        },
      },
      'v0.2 numeric range filters use "start"/"end", not "min"/"max"',
    );
  });

  it('continues to reject the chartType real-world payload', () => {
    expectSpecFailure(
      {
        version: 1,
        chartType: 'bar',
        title: 'x',
        fields: [{ caption: 'Rep Name', role: 'dimension', shelf: 'rows' }],
      },
      'Unknown top-level key "chartType"',
    );
  });

  it('rejects a field-level shelf key when it is the only offender', () => {
    expectSpecFailure(
      {
        version: '0.2.0',
        chart: 'bar',
        fields: [{ caption: 'Rep Name', role: 'dimension', shelf: 'rows' }],
      },
      'NotionalSpec v0.2 has no "shelf"',
    );
  });

  it.each([
    ['unknown field key', { extra: 'value' }, 'Unknown field key "extra"'],
    ['field data value', { data: 'integer' }, '"data" value "integer"'],
    ['field type value', { type: 'ordinal' }, '"type" value "ordinal"'],
    ['field role value', { role: 'metric' }, '"role" value "metric"'],
    ['field encoding value', { encoding: 'detail' }, 'detail/tooltip are v0.3-flag-only'],
  ])('rejects invalid %s', (_name, fieldPatch, expectedText) => {
    expectSpecFailure(
      {
        version: '0.2.0',
        chart: 'bar',
        fields: [{ caption: 'Region', ...fieldPatch }],
      },
      expectedText,
    );
  });

  it.each([
    ['unknown sort key', { by: 'Revenue', rank: 1 }, 'Unknown sort key "rank"'],
    ['missing sort by', { field: 'Region' }, '"sort.by" is required'],
    ['empty sort by', { by: '   ' }, '"sort.by" is required'],
    ['sort direction value', { by: 'Revenue', direction: 'down' }, '"sort.direction" value "down"'],
  ])('rejects invalid %s', (_name, sort, expectedText) => {
    expectSpecFailure(
      {
        ...EXAMPLE_1_SPEC,
        sort,
      },
      expectedText,
    );
  });

  it.each([
    [
      'unknown range filter key',
      { field: 'Revenue', aggregation: 'sum', lower: 1 },
      'Unknown rangeFilters key "lower"',
    ],
    ['range filter without field', { start: 1, end: 10 }, '"rangeFilters[0].field" is required'],
  ])('rejects invalid %s', (_name, rangeFilter, expectedText) => {
    expectSpecFailure(
      {
        ...EXAMPLE_1_SPEC,
        rangeFilters: [rangeFilter],
      },
      expectedText,
    );
  });

  it.each([
    [
      'unknown relative date filter key',
      {
        type: 'relative-date',
        field: 'Order Date',
        amount: 1,
        period: 'months',
        direction: 'previous',
        unit: 'month',
      },
      'Unknown relativeDateFilters key "unit"',
    ],
    [
      'relative date filter type',
      { type: 'relative', field: 'Order Date', amount: 1, period: 'months', direction: 'previous' },
      '"relativeDateFilters[0].type" value "relative"',
    ],
    [
      'relative date filter without field',
      { type: 'relative-date', amount: 1, period: 'months', direction: 'previous' },
      '"relativeDateFilters[0].field" is required',
    ],
    [
      'relative date filter amount',
      {
        type: 'relative-date',
        field: 'Order Date',
        amount: '1',
        period: 'months',
        direction: 'previous',
      },
      '"relativeDateFilters[0].amount" value "1"',
    ],
    [
      'relative date filter singular period',
      {
        type: 'relative-date',
        field: 'Order Date',
        amount: 1,
        period: 'month',
        direction: 'previous',
      },
      'Use plural relative date periods',
    ],
    [
      'relative date filter last direction',
      {
        type: 'relative-date',
        field: 'Order Date',
        amount: 1,
        period: 'months',
        direction: 'last',
      },
      '"last N months" is direction "previous"',
    ],
  ])('rejects invalid %s', (_name, relativeDateFilter, expectedText) => {
    expectSpecFailure(
      {
        ...EXAMPLE_1_SPEC,
        relativeDateFilters: [relativeDateFilter],
      },
      expectedText,
    );
  });

  it.each([
    [
      'unknown categorical filter key',
      { type: 'categorical', field: 'Region', values: ['West'], members: ['West'] },
      'Unknown categoricalFilters key "members"',
    ],
    [
      'categorical filter type',
      { type: 'category', field: 'Region', values: ['West'] },
      '"categoricalFilters[0].type" value "category"',
    ],
    [
      'categorical filter without field',
      { type: 'categorical', values: ['West'] },
      '"categoricalFilters[0].field" is required',
    ],
  ])('rejects invalid %s', (_name, categoricalFilter, expectedText) => {
    expectSpecFailure(
      {
        ...EXAMPLE_1_SPEC,
        categoricalFilters: [categoricalFilter],
      },
      expectedText,
    );
  });
});
