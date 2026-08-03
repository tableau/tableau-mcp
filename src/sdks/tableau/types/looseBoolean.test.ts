import { z } from 'zod';

import { looseBooleanFalsy } from './looseBoolean.js';

describe('looseBooleanFalsy', () => {
  it.each([
    ['a real true', true, true],
    ['a real false', false, false],
    ['the string "true"', 'true', true],
    ['the string "false"', 'false', false],
    ['mixed case "False"', 'False', false],
    ['mixed case "TRUE"', 'TRUE', true],
    ['padded " TRUE "', ' TRUE ', true],
    ['padded " false "', ' false ', false],
  ])('parses %s', (_label, input, expected) => {
    expect(looseBooleanFalsy.parse(input)).toBe(expected);
  });

  // The whole reason this schema exists: z.coerce.boolean() maps "false" to true,
  // which would invert every caller's fallback branch.
  it('does not coerce the string "false" to true the way z.coerce.boolean does', () => {
    expect(z.coerce.boolean().parse('false')).toBe(true);
    expect(looseBooleanFalsy.parse('false')).toBe(false);
  });

  it.each([
    ['junk text', 'maybe'],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['a number', 1],
    ['an object', { nested: true }],
    ['an array', [true]],
  ])('resolves %s to false rather than undefined', (_label, input) => {
    const parsed = looseBooleanFalsy.parse(input);
    expect(parsed).toBe(false);
    expect(parsed).not.toBeUndefined();
  });

  it('keeps the key required on the output side while allowing it to be absent on the input side', () => {
    const schema = z.object({ available: looseBooleanFalsy });

    // An absent key parses and lands `false` rather than `undefined`.
    expect(schema.parse({})).toEqual({ available: false });

    // Permissive in: the input type accepts the key being absent.
    const input: z.input<typeof schema> = {};
    expect(schema.parse(input)).toEqual({ available: false });

    // Definite out: the output type is a required boolean, so this assignment
    // compiles. If a future reshape made `available` optional, this line would
    // stop compiling — which is the point.
    const output: { available: boolean } = schema.parse({ available: 'true' });
    expect(output.available).toBe(true);
  });
});
