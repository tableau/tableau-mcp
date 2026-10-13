/** Text helpers shared by local Exchange catalog search and filtering. */
const STOP_WORDS = new Set(['a', 'an', 'and', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('en-US')
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

export function hasToken(text: string, token: string): boolean {
  return normalizeSearchText(text).split(' ').includes(token);
}

/**
 * Compare token sequences rather than substrings. This deliberately prevents a
 * query for "ai" from matching "paid".
 */
export function hasPhrase(text: string, phrase: string): boolean {
  const textTokens = normalizeSearchText(text).split(' ').filter(Boolean);
  const phraseTokens = normalizeSearchText(phrase).split(' ').filter(Boolean);
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
