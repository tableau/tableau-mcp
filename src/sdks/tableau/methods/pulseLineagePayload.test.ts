import { parsePulseLineagePayload } from './pulseLineagePayload.js';

const ds = '11111111-1111-4111-8111-111111111111',
  id = '22222222-2222-4222-8222-222222222222';
const definition = (extra: object = {}): object => ({
  metadata: { id, name: 'Sales' },
  specification: {
    datasource: { id: ds },
    basic_specification: { measure: { field: 'B' }, filters: [] },
  },
  ...extra,
});

describe('bounded Pulse usage projection', () => {
  it('keeps explicit invalid nested datasource scopes unresolved instead of using the parent', () => {
    const result = parsePulseLineagePayload(
      {
        definitions: [
          definition({ goals: [{ datasource: { id: 'invalid' }, measure: { field: 'Private' } }] }),
        ],
      },
      'definitions',
    );
    expect(result.owners[0].uses.find((use) => use.selector === 'Private')?.datasourceLuid).toBe(
      'invalid',
    );
  });
  it('honors the explicit datasource_luid override and escapes native JSON pointer keys', () => {
    const foreign = '44444444-4444-4444-8444-444444444444';
    const result = parsePulseLineagePayload(
      {
        definitions: [
          definition({ 'a/b~': { datasource: { id: ds }, datasource_luid: foreign, field: 'X' } }),
        ],
      },
      'definitions',
    );
    expect(result.owners[0].uses.find((use) => use.selector === 'X')).toMatchObject({
      path: '/definitions/0/a~1b~0/field',
      datasourceLuid: foreign,
    });
  });
  it('treats viz-state text as opaque and never reads paths, scripts or credentials', () => {
    const result = parsePulseLineagePayload(
      {
        definitions: [
          definition({
            password: 'PRIVATE_CANARY',
            scriptBody: 'PRIVATE_CANARY',
            viz_state_specification: { viz_state_string: '{"field":"NotAReference"}' },
          }),
        ],
      },
      'definitions',
    );
    expect(result.owners[0].opaque).toBe(true);
    expect(JSON.stringify(result.owners)).not.toMatch(/PRIVATE_CANARY|NotAReference/);
  });
  it('keeps scalar values including empty strings, false, zero and null', () => {
    const result = parsePulseLineagePayload(
      {
        definitions: [
          definition({
            filters: [
              {
                field: 'B',
                categorical_values: [
                  { string_value: '' },
                  { bool_value: false },
                  { number_value: 0 },
                  { null_value: null },
                ],
              },
            ],
          }),
        ],
      },
      'definitions',
    );
    expect(result.owners[0].uses.find((use) => use.role === 'pulse-filter')?.values).toEqual([
      '',
      false,
      0,
      null,
    ]);
  });
  it.each([
    null,
    1,
    'json',
    {},
    { definitions: null },
    { definitions: [null] },
    { definitions: [{ metadata: { id: '../bad' } }] },
    { definitions: [], next_page_token: 17 },
    { definitions: [], total_available: -1 },
  ])('rejects malformed collection %j without treating it as empty', (payload) => {
    expect(() => parsePulseLineagePayload(payload, 'definitions')).toThrow();
  });
  it('reports bounds on values, nesting and total selectors', () => {
    const values = Array.from({ length: 101 }, (_, i) => ({ number_value: i }));
    const result = parsePulseLineagePayload(
      { definitions: [definition({ filters: [{ field: 'B', categorical_values: values }] })] },
      'definitions',
    );
    expect(result.limited).toBe(true);
    expect(result.owners[0].uses.find((use) => use.role === 'pulse-filter')?.values).toHaveLength(
      100,
    );
    let nested: Record<string, unknown> = { field: 'X' };
    for (let i = 0; i < 42; i++) nested = { next: nested };
    expect(
      parsePulseLineagePayload({ definitions: [definition({ nested })] }, 'definitions').limited,
    ).toBe(true);
    expect(
      parsePulseLineagePayload(
        {
          definitions: [
            definition({ extension_options: { allowed_dimensions: Array(5001).fill('B') } }),
          ],
        },
        'definitions',
      ).limited,
    ).toBe(true);
  });
});
