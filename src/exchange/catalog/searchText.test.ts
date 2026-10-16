import { hasToken, normalizeSearchText, searchableTokens } from './searchText.js';

describe('normalizeSearchText', () => {
  it('folds Latin diacritics so accented and unaccented spellings match', () => {
    expect(normalizeSearchText('Café')).toBe('cafe');
    expect(normalizeSearchText('Café')).toBe(normalizeSearchText('cafe'));
    expect(hasToken('Café Dashboard', 'cafe')).toBe(true);
  });

  it('composes compatibility and width variants to their canonical form', () => {
    expect(normalizeSearchText('ﬁle')).toBe('file'); // U+FB01 ligature
    expect(normalizeSearchText('ＥＸＰＯＲＴ')).toBe('export'); // full-width Latin
  });

  it('preserves Japanese voiced kana rather than splitting the combining mark', () => {
    // The combining voiced mark U+3099 must stay attached to its kana, not be stripped as an
    // accent (which previously turned が into "か" or orphaned the mark into a token break).
    expect(normalizeSearchText('が')).toBe('が');
    expect(normalizeSearchText('が')).not.toBe(normalizeSearchText('か'));
    expect(normalizeSearchText('がが')).toBe('がが');
    expect(searchableTokens('データ')).toEqual(['データ']); // one token, not "テ ータ"
  });
});
