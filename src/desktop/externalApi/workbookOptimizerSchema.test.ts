import { workbookOptimizerResultSchema } from './types.js';

const validResult = {
  suggestions: [
    {
      ruleId: 7,
      title: 'Simplify nested calculations',
      description: 'Nested calculations can be harder to maintain.',
      status: 'NEEDS_REVIEW' as const,
      affected: {
        count: 2,
        items: [
          {
            name: 'Sales by Region',
            items: [
              {
                name: '[Sample - Superstore].[Calculation]',
                value: 3,
                items: [{ name: 'Nested calculation', extraItemField: true }],
              },
            ],
          },
        ],
        extraAffectedField: 'preserved',
      },
      extraSuggestionField: 'preserved',
    },
  ],
  extraResultField: 'preserved',
};

describe('workbookOptimizerResultSchema', () => {
  it('preserves a recursive affected-item tree and additive fields', () => {
    const parsed = workbookOptimizerResultSchema.parse(validResult);

    expect(parsed).toMatchObject(validResult);
    expect(parsed.suggestions[0].affected.items[0].items?.[0].items?.[0]).toMatchObject({
      name: 'Nested calculation',
      extraItemField: true,
    });
  });

  it.each([
    [
      'zero rule id',
      { ...validResult, suggestions: [{ ...validResult.suggestions[0], ruleId: 0 }] },
    ],
    [
      'fractional rule id',
      { ...validResult, suggestions: [{ ...validResult.suggestions[0], ruleId: 1.5 }] },
    ],
    [
      'unknown status',
      { ...validResult, suggestions: [{ ...validResult.suggestions[0], status: 'UNKNOWN' }] },
    ],
    [
      'negative affected count',
      {
        ...validResult,
        suggestions: [
          {
            ...validResult.suggestions[0],
            affected: { ...validResult.suggestions[0].affected, count: -1 },
          },
        ],
      },
    ],
    [
      'fractional affected count',
      {
        ...validResult,
        suggestions: [
          {
            ...validResult.suggestions[0],
            affected: { ...validResult.suggestions[0].affected, count: 1.5 },
          },
        ],
      },
    ],
    [
      'negative item value',
      {
        ...validResult,
        suggestions: [
          {
            ...validResult.suggestions[0],
            affected: {
              ...validResult.suggestions[0].affected,
              items: [{ name: 'Sales by Region', value: -1 }],
            },
          },
        ],
      },
    ],
    [
      'missing required title',
      {
        ...validResult,
        suggestions: [
          {
            ruleId: 1,
            description: 'Description',
            status: 'PASS',
            affected: { count: 0, items: [] },
          },
        ],
      },
    ],
  ])('rejects a %s', (_name, result) => {
    expect(workbookOptimizerResultSchema.safeParse(result).success).toBe(false);
  });
});
