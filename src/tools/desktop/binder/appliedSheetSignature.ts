import type { InjectTemplateArgs } from '../../../desktop/binder/binder.js';

/**
 * Deterministic JSON with object keys sorted at every depth, so two structurally equal
 * arg objects always stringify to the same text. Array order is preserved (not sorted):
 * a different order is treated as a different sheet, which fails SAFE — the bind just
 * proceeds normally instead of reusing.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(',')}}`;
}

/**
 * Identity of the SHEET a bound result would produce, ignoring `title`.
 *
 * Title is excluded on purpose. On the Call-1 fast path the binder derives the title from
 * the ask text (`makeTitle` in binder.ts truncates the ask to 80 chars), so two paraphrases
 * of one chart differ in title and in NOTHING else — which is exactly the re-bind loop this
 * signature exists to spot.
 *
 * Every other arg is included by walking the object generically rather than by listing
 * fields, so a future addition to InjectTemplateArgs cannot be silently left out and make
 * two genuinely different sheets look identical.
 */
export function appliedSheetSignature(args: InjectTemplateArgs): string {
  const { title: _title, ...rest } = args;
  return stableStringify(rest);
}
