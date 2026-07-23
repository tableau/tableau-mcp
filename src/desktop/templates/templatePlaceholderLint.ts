import type { TemplateManifest } from '../binder/manifest-types.js';

const DONOR_EXAMPLE_VOCABULARY = [
  'Region',
  'Sales',
  'Sub-Category',
  'Order Date',
  'Profit',
  'Superstore',
];

function normalizedTokens(value: string): string[] {
  return value.toLocaleLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function containsTokenSequence(tokens: readonly string[], sequence: readonly string[]): boolean {
  if (sequence.length === 0 || sequence.length > tokens.length) return false;

  for (let i = 0; i <= tokens.length - sequence.length; i++) {
    if (sequence.every((token, j) => tokens[i + j] === token)) return true;
  }
  return false;
}

export function findDonorVocabularyInMigratedExamples(
  manifests: Map<string, TemplateManifest>,
  migratedTemplates: readonly string[],
): string[] {
  const offenders: string[] = [];
  const donorTokenSequences = DONOR_EXAMPLE_VOCABULARY.map((term) => ({
    term,
    tokens: normalizedTokens(term),
  }));

  for (const name of migratedTemplates) {
    const manifest = manifests.get(name);
    if (!manifest) continue;
    for (const slot of manifest.slots) {
      for (const example of slot.examples ?? []) {
        const exampleTokens = normalizedTokens(example);
        const donor = donorTokenSequences.find(({ tokens }) =>
          containsTokenSequence(exampleTokens, tokens),
        );
        if (donor) {
          offenders.push(
            `${name}:${slot.slot_id} example "${example}" contains donor vocabulary "${donor.term}"`,
          );
        }
      }
    }
  }

  return offenders;
}
