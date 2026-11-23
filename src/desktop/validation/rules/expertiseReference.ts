import { getExpertiseCorpusEntryCount } from '../../expertise/index.js';

export function expertiseReference(text: string): string {
  return getExpertiseCorpusEntryCount() > 0 ? text : '';
}
