/**
 * Ambiguity heuristics — NOT part of the metadata model.
 *
 * These are the "smart" tie-breaks and warnings the resolver applies when a
 * user-supplied name matches more than one field. They encode policy (which
 * near-duplicate wins, when to warn about a messy source), not structural truth,
 * so they live in the resolution layer, away from `metadata/datasource.ts`.
 */
import { displayName, type Field } from '../metadata/datasource.js';

function numericSuffixParts(name: string): { base: string; suffix: string | null } {
  const match = name.match(/^(.*?)(\d+)$/);
  if (!match || match[1].length === 0) return { base: name, suffix: null };
  return { base: match[1], suffix: match[2] };
}

/**
 * A near-duplicate cleanup note when the chosen field belongs to a numeric-suffix
 * family (`Country`/`Country1`). Same policy as the legacy resolver.
 */
export function nearDuplicateNote(fields: ReadonlyArray<Field>, chosen: Field): string | undefined {
  const chosenName = displayName(chosen);
  const chosenBase = numericSuffixParts(chosenName).base;
  const family = fields.filter((f) => numericSuffixParts(displayName(f)).base === chosenBase);
  if (family.length < 2 || !family.some((f) => f !== chosen)) return undefined;
  const names = [...new Set(family.map(displayName))].sort((a, b) => {
    const aSuffix = numericSuffixParts(a).suffix;
    const bSuffix = numericSuffixParts(b).suffix;
    if (aSuffix === null && bSuffix !== null) return -1;
    if (aSuffix !== null && bSuffix === null) return 1;
    return a.localeCompare(b);
  });
  return `dataset has near-duplicate columns ${names.join('/')} - used ${chosenName}; consider cleaning the source`;
}

/**
 * Break a tie deterministically: an exact-caption match wins; else the single
 * unsuffixed member of a numeric-suffix family wins. Returns null when neither
 * rule applies (genuinely ambiguous).
 */
export function disambiguateRanked(candidates: Field[], query: string): Field | null {
  const captionMatches = candidates.filter((f) => f.caption === query);
  if (captionMatches.length === 1) return captionMatches[0];

  const parts = candidates.map((c) => numericSuffixParts(displayName(c)));
  const bases = new Set(parts.map((p) => p.base));
  const unsuffixed = candidates.filter((_, i) => parts[i].suffix === null);
  const suffixed = candidates.filter((_, i) => parts[i].suffix !== null);
  if (bases.size === 1 && unsuffixed.length === 1 && suffixed.length > 0) {
    return unsuffixed[0];
  }
  return null;
}
