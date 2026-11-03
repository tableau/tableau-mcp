import { decodeCursor, encodeCursor, InvalidSkillsCursorError } from './cursor.js';

const encode = (text: string): string => Buffer.from(text).toString('base64url');

describe('skills cursor', () => {
  const total = 31;

  it('encodes an offset in canonical base64url', () => {
    expect(encodeCursor(30)).toBe(encode('30'));
  });

  it('round-trips an advancing offset', () => {
    expect(decodeCursor(encodeCursor(15), total)).toBe(15);
  });

  it.each([
    ['empty', ''],
    ['not base64url', 'not base64!'],
    ['padded base64', `${encode('30')}=`],
    ['garbage text', encode('hello')],
    ['non-numeric text', encode('offset:30')],
    ['exponent notation', encode('3e1')],
    ['zero offset', encode('0')],
    ['negative offset', encode('-1')],
    ['float offset', encode('1.5')],
    ['leading zero', encode('030')],
    ['unsafe integer', encode('9007199254740993')],
    ['oversized', encode('9'.repeat(100))],
    ['offset at end of registry', encode(`${total}`)],
    ['offset past end of registry', encode(`${total + 1}`)],
  ])('rejects a %s cursor', (_label, cursor) => {
    expect(() => decodeCursor(cursor, total)).toThrow(InvalidSkillsCursorError);
  });

  it('accepts the last advancing offset', () => {
    expect(decodeCursor(encode(`${total - 1}`), total)).toBe(total - 1);
  });

  it('rejects a non-canonical encoding of a valid offset', () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const cursor = encodeCursor(30);
    const altered = cursor.slice(0, -1) + alphabet[alphabet.indexOf(cursor.at(-1)!) + 1];
    // Same decoded bytes, different text: only the canonical form is accepted.
    expect(Buffer.from(altered, 'base64url')).toEqual(Buffer.from(cursor, 'base64url'));

    expect(() => decodeCursor(altered, total)).toThrow(InvalidSkillsCursorError);
  });

  it('rejects any cursor on an empty registry', () => {
    expect(() => decodeCursor(encode('1'), 0)).toThrow(InvalidSkillsCursorError);
  });

  it('does not echo the cursor in the error message', () => {
    expect(() => decodeCursor('secret-cursor!', total)).toThrow(/^(?!.*secret)/);
  });
});
