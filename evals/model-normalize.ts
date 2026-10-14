/**
 * Model id normalization.
 *
 * Different harnesses report the same underlying model with different ids
 * (Cursor `sonnet-4.5`, Claude `claude-sonnet-4-5-20250101`, LangSmith
 * `ls_model_name`, etc.). Reports group on a single canonical id so the same model
 * run through different harnesses lines up. Both the raw id and the normalized id
 * are recorded on each grade.
 */

/** Ordered rules: the first regex that matches maps to the canonical id. */
const RULES: Array<{ pattern: RegExp; canonical: string }> = [
  // Anthropic Claude family
  { pattern: /opus-4[.\- ]?8/i, canonical: 'claude-opus-4.8' },
  { pattern: /opus-4[.\- ]?7/i, canonical: 'claude-opus-4.7' },
  { pattern: /opus-4[.\- ]?6/i, canonical: 'claude-opus-4.6' },
  { pattern: /opus-4/i, canonical: 'claude-opus-4' },
  { pattern: /sonnet-4[.\- ]?6|sonnet-4-6/i, canonical: 'claude-sonnet-4.6' },
  { pattern: /sonnet-4[.\- ]?5|sonnet-4-5/i, canonical: 'claude-sonnet-4.5' },
  { pattern: /sonnet-4/i, canonical: 'claude-sonnet-4' },
  { pattern: /haiku-4[.\- ]?5|haiku-4-5/i, canonical: 'claude-haiku-4.5' },
  { pattern: /claude.*3[.\- ]?7.*sonnet|3-7-sonnet/i, canonical: 'claude-3.7-sonnet' },
  // OpenAI / Codex family
  { pattern: /gpt-5[.\- ]?6.*codex|gpt-5-6-codex/i, canonical: 'gpt-5.6-codex' },
  { pattern: /gpt-5.*codex/i, canonical: 'gpt-5-codex' },
  { pattern: /gpt-5[.\- ]?6/i, canonical: 'gpt-5.6' },
  { pattern: /gpt-5/i, canonical: 'gpt-5' },
  { pattern: /gpt-4o[.\- ]?mini/i, canonical: 'gpt-4o-mini' },
  { pattern: /gpt-4o/i, canonical: 'gpt-4o' },
  { pattern: /o4[.\- ]?mini/i, canonical: 'o4-mini' },
  { pattern: /o3/i, canonical: 'o3' },
  // Google Gemini
  { pattern: /gemini-3[.\- ]?1.*pro/i, canonical: 'gemini-3.1-pro' },
  { pattern: /gemini.*pro/i, canonical: 'gemini-pro' },
];

export function normalizeModel(raw: string | null | undefined): string {
  if (!raw) return 'unknown';
  const trimmed = raw.trim();
  for (const rule of RULES) {
    if (rule.pattern.test(trimmed)) return rule.canonical;
  }
  // Fall back to a lightly-cleaned raw id (strip trailing date stamps).
  return trimmed.replace(/-\d{8}$/, '').toLowerCase();
}
