import type { TemplateManifest } from '../binder/manifest-types.js';

const DONOR_EXAMPLE_VOCABULARY = [
  'Region',
  'Sales',
  'Sub-Category',
  'Order Date',
  'Profit',
  'Superstore',
];

export function findDonorVocabularyInMigratedExamples(
  manifests: Map<string, TemplateManifest>,
  migratedTemplates: readonly string[],
): string[] {
  const offenders: string[] = [];

  for (const name of migratedTemplates) {
    const manifest = manifests.get(name);
    if (!manifest) continue;
    for (const slot of manifest.slots) {
      for (const example of slot.examples ?? []) {
        const donor = DONOR_EXAMPLE_VOCABULARY.find((term) =>
          example.toLocaleLowerCase().includes(term.toLocaleLowerCase()),
        );
        if (donor) {
          offenders.push(
            `${name}:${slot.slot_id} example "${example}" contains donor vocabulary "${donor}"`,
          );
        }
      }
    }
  }

  return offenders;
}
