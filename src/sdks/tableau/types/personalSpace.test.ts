import { personalSpaceSchema } from './personalSpace.js';

const base = {
  luid: 'ps-luid',
  ownerLuid: 'owner-luid',
};

describe('personalSpaceSchema', () => {
  it.each([
    ['a real false', false, false],
    ['the string "false"', 'false', false],
    ['mixed case "False"', 'False', false],
    ['padded " false "', ' false ', false],
  ])('parses readOnly %s as false', (_label, input, expected) => {
    expect(personalSpaceSchema.parse({ ...base, readOnly: input }).readOnly).toBe(expected);
  });

  it.each([
    ['a real true', true],
    ['the string "true"', 'true'],
    ['mixed case "TRUE"', 'TRUE'],
    ['padded " true "', ' true '],
  ])('parses readOnly %s as true', (_label, input) => {
    expect(personalSpaceSchema.parse({ ...base, readOnly: input }).readOnly).toBe(true);
  });

  // readOnly gates whether publish-workbook may publish into this space, so anything
  // unrecognized must fail CLOSED (readOnly: true) — the opposite of looseBooleanFalsy's polarity.
  it.each([
    ['junk text', 'maybe'],
    ['an empty string', ''],
    ['a number', 1],
    ['null', null],
    ['an object', { nested: true }],
  ])('fails closed to readOnly: true for %s', (_label, input) => {
    expect(personalSpaceSchema.parse({ ...base, readOnly: input }).readOnly).toBe(true);
  });

  it('fails closed to readOnly: true when the key is missing', () => {
    expect(personalSpaceSchema.parse(base).readOnly).toBe(true);
  });

  it('requires luid and ownerLuid', () => {
    expect(
      personalSpaceSchema.safeParse({ ownerLuid: 'owner-luid', readOnly: false }).success,
    ).toBe(false);
    expect(personalSpaceSchema.safeParse({ luid: 'ps-luid', readOnly: false }).success).toBe(false);
  });
});
