import { decodeCursor, encodeCursor, InvalidSkillsCursorError } from './cursor.js';

const encode = (text: string): string => Buffer.from(text).toString('base64url');

describe('skills cursor', () => {
  const total = 51;

  it('encodes a versioned offset in canonical base64url', () => {
    expect(encodeCursor(50)).toBe(encode('v1:50'));
  });

  it('round-trips an advancing offset', () => {
    expect(decodeCursor(encodeCursor(25), total)).toBe(25);
  });

  it.each([
    ['empty', ''],
    ['not base64url', 'not base64!'],
    ['padded base64', `${encode('v1:50')}=`],
    ['garbage text', encode('hello')],
    ['unknown version', encode('v2:50')],
    ['missing version', encode('50')],
    ['zero offset', encode('v1:0')],
    ['negative offset', encode('v1:-1')],
    ['float offset', encode('v1:1.5')],
    ['leading zero', encode('v1:050')],
    ['unsafe integer', encode('v1:9007199254740993')],
    ['oversized', encode(`v1:${'9'.repeat(100)}`)],
    ['offset at end of registry', encode(`v1:${total}`)],
    ['offset past end of registry', encode(`v1:${total + 1}`)],
  ])('rejects a %s cursor', (_label, cursor) => {
    expect(() => decodeCursor(cursor, total)).toThrow(InvalidSkillsCursorError);
  });

  it('accepts the last advancing offset', () => {
    expect(decodeCursor(encode(`v1:${total - 1}`), total)).toBe(total - 1);
  });

  it('rejects a non-canonical encoding of a valid offset', () => {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const cursor = encodeCursor(50);
    const altered = cursor.slice(0, -1) + alphabet[alphabet.indexOf(cursor.at(-1)!) + 1];
    // Same decoded bytes, different text: only the canonical form is accepted.
    expect(Buffer.from(altered, 'base64url')).toEqual(Buffer.from(cursor, 'base64url'));

    expect(() => decodeCursor(altered, total)).toThrow(InvalidSkillsCursorError);
  });

  it('rejects any cursor on an empty registry', () => {
    expect(() => decodeCursor(encode('v1:1'), 0)).toThrow(InvalidSkillsCursorError);
  });

  it('does not echo the cursor in the error message', () => {
    expect(() => decodeCursor('secret-cursor!', total)).toThrow(/^(?!.*secret)/);
  });
});
