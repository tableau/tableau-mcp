/** Text helpers shared by local Exchange catalog search and filtering. */
const STOP_WORDS = new Set(['a', 'an', 'and', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKC') // compatibility-compose: fold \ufb01\u2192fi, \u2460\u21921, half/full-width; keep \u304c composed
    .toLocaleLowerCase('en-US')
    .normalize('NFD') // decompose to expose combining diacritics
    .replace(/[\u0300-\u036f]/gu, '') // fold Latin/Greek/Cyrillic accents only \u2014 NOT kana marks U+3099/309A
    .normalize('NFC') // recompose, so a kept kana mark is not orphaned into a space below
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

export function searchableTokens(value: string): string[] {
  return [
    ...new Set(
      normalizeSearchText(value)
        .split(' ')
        .filter((token) => token.length > 0 && !STOP_WORDS.has(token)),
    ),
  ];
}

/** Folds simple English plurals so "maps" matches "map" and "categories" matches "category". */
export function stemToken(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.endsWith('s') && !/(ss|us|is)$/u.test(token)) return token.slice(0, -1);
  return token;
}

export function stemmedTokens(text: string): string[] {
  return normalizeSearchText(text).split(' ').filter(Boolean).map(stemToken);
}

export function hasToken(text: string, token: string): boolean {
  return stemmedTokens(text).includes(stemToken(token));
}

/**
 * Compare token sequences rather than substrings. This deliberately prevents a
 * query for "ai" from matching "paid".
 */
export function hasPhrase(text: string, phrase: string): boolean {
  const textTokens = stemmedTokens(text);
  const phraseTokens = stemmedTokens(phrase);
  if (phraseTokens.length === 0 || phraseTokens.length > textTokens.length) return false;

  return textTokens.some((_, start) =>
    phraseTokens.every((token, offset) => textTokens[start + offset] === token),
  );
}

export function compareReportedVersions(minimum: string, requested: string): number | null {
  const toParts = (value: string): number[] | null => {
    const match = value.trim().match(/^(\d+)\.(\d+)(?:\.(\d+))?$/u);
    if (!match) return null;
    return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
  };
  const left = toParts(minimum);
  const right = toParts(requested);
  if (!left || !right) return null;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}
