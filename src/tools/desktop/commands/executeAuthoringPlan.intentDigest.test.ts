import {
  compileIntentPlan,
  createIntentDigest,
  IntentDigestCompileError,
  postconditionSchema,
} from './executeAuthoringPlan.intentDigest.js';

const legacyFilter = {
  kind: 'filter-signature' as const,
  worksheet: 'Sales',
  column: '[Sample].[none:Region:nk]',
  members: ['East', 'West'],
  mode: 'include' as const,
};

const allPostconditions = [
  { kind: 'worksheet-exists', name: 'Sales' },
  { kind: 'dashboard-exists', name: 'Overview' },
  { kind: 'datasource-exists', name: 'Sample' },
  {
    kind: 'calculation-signature',
    datasource: 'Sample',
    name: 'Profit Ratio',
    formula: 'SUM([Profit]) / SUM([Sales])',
    datatype: 'real',
    role: 'measure',
  },
  { kind: 'datasource-binding', worksheet: 'Sales', datasource: 'Sample' },
  {
    kind: 'field-binding',
    worksheet: 'Sales',
    placement: 'rows',
    field: '[Sample].[sum:Sales:qk]',
  },
  legacyFilter,
  { kind: 'mark-type', worksheet: 'Sales', mark: 'Bar' },
  {
    kind: 'encoding',
    worksheet: 'Sales',
    channel: 'color',
    field: '[Sample].[none:Region:nk]',
  },
  { kind: 'dashboard-contains', dashboard: 'Overview', worksheet: 'Sales' },
  {
    kind: 'dashboard-zone',
    dashboard: 'Overview',
    worksheet: 'Sales',
    zoneType: 'worksheet',
    multiplicity: 1,
  },
  {
    kind: 'summary-signature',
    worksheet: 'Sales',
    columns: ['Region', 'SUM(Sales)'],
    rows: [
      ['East', 10, true, null],
      ['West', 20, false, null],
    ],
  },
];

describe('executeAuthoringPlan intent digest', () => {
  it('accepts all twelve singular postcondition variants', () => {
    for (const postcondition of allPostconditions) {
      expect(postconditionSchema.safeParse(postcondition).success, postcondition.kind).toBe(true);
    }
  });

  it('rejects non-scalar summary row values', () => {
    const parsed = postconditionSchema.safeParse({
      kind: 'summary-signature',
      worksheet: 'Sales',
      columns: ['Region'],
      rows: [[{ region: 'East' }]],
    });

    expect(parsed.success).toBe(false);
  });

  it('normalizes an omitted legacy filter function to canonical null', () => {
    const plan = compileIntentPlan([
      {
        step: 1,
        command: 'tabdoc:save',
        dispatchArgs: {},
        expect: legacyFilter,
      },
    ]);

    expect(plan.digest.assertions[0].expect).toEqual({
      ...legacyFilter,
      function: null,
    });
  });

  it('canonicalizes object keys without reordering semantic arrays', () => {
    const left = {
      schemaVersion: 1 as const,
      assertions: [
        {
          id: 'a',
          introducedByStep: 1,
          checkpoint: 'final' as const,
          expect: { kind: 'worksheet-exists' as const, name: 'Sales' },
        },
        {
          id: 'b',
          introducedByStep: 2,
          checkpoint: 'final' as const,
          expect: { kind: 'dashboard-exists' as const, name: 'Overview' },
        },
      ],
    };
    const right = {
      assertions: left.assertions.map((assertion) => ({
        expect: assertion.expect,
        checkpoint: assertion.checkpoint,
        introducedByStep: assertion.introducedByStep,
        id: assertion.id,
      })),
      schemaVersion: 1 as const,
    };

    expect(createIntentDigest(left)).toEqual(createIntentDigest(right));
    expect(
      createIntentDigest({ ...left, assertions: [...left.assertions].reverse() }).sha256,
    ).not.toBe(createIntentDigest(left).sha256);
  });

  it('hashes explicit null as deterministic lowercase SHA-256', () => {
    const payload = {
      schemaVersion: 1 as const,
      assertions: [
        {
          id: 'filter',
          introducedByStep: 1,
          checkpoint: 'final' as const,
          expect: {
            kind: 'filter-signature' as const,
            worksheet: 'Sales',
            column: 'Region',
            members: ['East'],
            mode: 'include' as const,
            function: null,
          },
        },
      ],
    };
    const digest = createIntentDigest(payload);

    expect(digest.canonicalBytes).toContain('"function":null');
    expect(digest.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(createIntentDigest(payload).sha256).toBe(digest.sha256);
    expect(
      createIntentDigest({
        ...payload,
        assertions: [
          {
            ...payload.assertions[0],
            expect: { ...payload.assertions[0].expect, worksheet: 'Profit' },
          },
        ],
      }).sha256,
    ).not.toBe(digest.sha256);
  });

  it('compiles exact effects, dependencies, derived assertions, and checkpoints', () => {
    const plan = compileIntentPlan([
      {
        step: 1,
        command: 'tabdoc:new-worksheet',
        dispatchArgs: { NewSheet: 'Sales' },
      },
      {
        step: 2,
        command: 'tabdoc:generate-viz-from-notional-spec',
        dispatchArgs: {
          NotionalSpecJson: JSON.stringify({
            version: '0.2.0',
            chart: 'bar',
            fields: [
              {
                fieldIdentifier: '[Sample].[none:Region:nk]',
                encoding: 'color',
              },
            ],
          }),
          ClearSheet: true,
        },
      },
      { step: 3, command: 'tabdoc:save', dispatchArgs: {} },
    ]);

    expect(plan.effectsByStep[1]).toMatchObject({
      mutationClass: 'load-bearing',
      provides: [{ kind: 'worksheet', identity: 'Sales' }],
      requires: [],
      derivedAssertions: [{ kind: 'worksheet-exists', name: 'Sales' }],
    });
    expect(plan.effectsByStep[2]).toMatchObject({
      mutationClass: 'load-bearing',
      requires: [{ kind: 'worksheet', identity: 'Sales' }],
    });
    expect(plan.effectsByStep[3]).toEqual({
      mutationClass: 'non-asserting-checkpoint',
      provides: [],
      requires: [],
      derivedAssertions: [],
    });
    expect(plan.dependencyEdges).toEqual([
      {
        fromStep: 1,
        toStep: 2,
        symbol: { kind: 'worksheet', identity: 'Sales' },
      },
    ]);
    expect(plan.digest.assertions.map(({ expect }) => expect)).toEqual([
      { kind: 'worksheet-exists', name: 'Sales' },
      { kind: 'mark-type', worksheet: 'Sales', mark: 'Bar' },
      {
        kind: 'encoding',
        worksheet: 'Sales',
        channel: 'color',
        field: '[Sample].[none:Region:nk]',
      },
    ]);
    expect(plan.digest.assertions[0].checkpoint).toBe('immediate');
    expect(plan.immediateAssertionIdsByProducingStep[1]).toEqual([plan.digest.assertions[0].id]);
  });

  it('includes explicit expectations with deterministic IDs', () => {
    const steps = [
      {
        step: 1,
        command: 'tabdoc:save',
        dispatchArgs: {},
        expect: { kind: 'worksheet-exists' as const, name: 'Sales' },
      },
    ];

    const first = compileIntentPlan(steps);
    const second = compileIntentPlan(steps);

    expect(first.digest.assertions).toEqual(second.digest.assertions);
    expect(first.digest.assertions[0]).toMatchObject({
      introducedByStep: 1,
      checkpoint: 'final',
      expect: steps[0].expect,
    });
  });

  it('allows two worksheets to bind the same field identifier', () => {
    const notionalSpec = JSON.stringify({
      version: '0.2.0',
      fields: [{ fieldIdentifier: '[Sample].[none:Region:nk]', encoding: 'color' }],
    });

    const plan = compileIntentPlan([
      {
        step: 1,
        command: 'tabdoc:new-worksheet',
        dispatchArgs: { NewSheet: 'Sales' },
      },
      {
        step: 2,
        command: 'tabdoc:generate-viz-from-notional-spec',
        dispatchArgs: { NotionalSpecJson: notionalSpec },
      },
      {
        step: 3,
        command: 'tabdoc:new-worksheet',
        dispatchArgs: { NewSheet: 'Profit' },
      },
      {
        step: 4,
        command: 'tabdoc:generate-viz-from-notional-spec',
        dispatchArgs: { NotionalSpecJson: notionalSpec },
      },
    ]);

    expect(plan.effectsByStep[2].provides).toEqual([]);
    expect(plan.effectsByStep[4].provides).toEqual([]);
    expect(plan.dependencyEdges).toEqual([
      {
        fromStep: 1,
        toStep: 2,
        symbol: { kind: 'worksheet', identity: 'Sales' },
      },
      {
        fromStep: 3,
        toStep: 4,
        symbol: { kind: 'worksheet', identity: 'Profit' },
      },
    ]);
  });

  it.each([
    {
      name: 'unsupported mutation',
      steps: [{ step: 1, command: 'tabdoc:delete-sheet', dispatchArgs: { Sheet: 'Sales' } }],
      message: 'unclassified command',
    },
    {
      name: 'unresolved active worksheet',
      steps: [
        {
          step: 1,
          command: 'tabdoc:generate-viz-from-notional-spec',
          dispatchArgs: { NotionalSpecJson: '{"version":"0.2.0","fields":[]}' },
        },
      ],
      message: 'unresolved reference',
    },
    {
      name: 'implicit unobservable active worksheet',
      steps: [
        { step: 1, command: 'tabdoc:new-worksheet', dispatchArgs: {} },
        {
          step: 2,
          command: 'tabdoc:generate-viz-from-notional-spec',
          dispatchArgs: { NotionalSpecJson: '{"version":"0.2.0","fields":[]}' },
        },
      ],
      message: 'observable worksheet identity',
    },
    {
      name: 'duplicate producer',
      steps: [
        {
          step: 1,
          command: 'tabdoc:new-worksheet',
          dispatchArgs: { NewSheet: 'Sales' },
        },
        {
          step: 2,
          command: 'tabdoc:new-worksheet',
          dispatchArgs: { NewSheet: 'Sales' },
        },
      ],
      message: 'duplicate producer',
    },
    {
      name: 'forward reference',
      steps: [
        {
          step: 1,
          command: 'tabdoc:generate-viz-from-notional-spec',
          dispatchArgs: { NotionalSpecJson: '{"version":"0.2.0","fields":[]}' },
        },
        {
          step: 2,
          command: 'tabdoc:new-worksheet',
          dispatchArgs: { NewSheet: 'Sales' },
        },
      ],
      message: 'forward reference',
    },
    {
      name: 'unobservable field derivation',
      steps: [
        {
          step: 1,
          command: 'tabdoc:save',
          dispatchArgs: {},
          expect: {
            kind: 'field-binding' as const,
            worksheet: 'Sales',
            placement: 'rows',
            field: '[Sample].[sum:Sales:qk]',
            derivation: 'Sum',
          },
        },
      ],
      message: 'worksheet readback cannot observe field derivation',
    },
    {
      name: 'datasource creation assertion',
      steps: [
        {
          step: 1,
          command: 'tabdoc:save',
          dispatchArgs: {},
          expect: { kind: 'datasource-exists' as const, name: 'Sample' },
        },
      ],
      message: 'no admitted command can create a datasource',
    },
  ])('fails closed for $name', ({ steps, message }) => {
    const prepared = steps as Array<{
      step: number;
      command: string;
      dispatchArgs: Record<string, unknown>;
    }>;
    expect(() => compileIntentPlan(prepared)).toThrowError(IntentDigestCompileError);
    expect(() => compileIntentPlan(prepared)).toThrow(message);
  });
});
