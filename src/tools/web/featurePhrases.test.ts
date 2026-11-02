import { describe, expect, it } from 'vitest';

import { featurePhrasesForTools } from './featurePhrases.js';

describe('featurePhrasesForTools', () => {
  it('maps a tool to its group phrase', () => {
    expect(featurePhrasesForTools(['publish-workbook'])).toEqual([
      'publishing workbooks and data sources',
    ]);
  });
  it('de-duplicates tools that share a group', () => {
    expect(featurePhrasesForTools(['publish-workbook', 'publish-datasource'])).toEqual([
      'publishing workbooks and data sources',
    ]);
  });
  it('returns distinct phrases across groups in declaration order', () => {
    // scaffold-data-app is in group "data-apps" (declared last); download-workbook in "workbook" (early)
    expect(featurePhrasesForTools(['scaffold-data-app', 'download-workbook'])).toEqual([
      'viewing and downloading workbooks',
      'building data apps',
    ]);
  });
  it('falls back to the raw tool name for an unmapped tool', () => {
    expect(featurePhrasesForTools(['not-a-real-tool'])).toEqual(['not-a-real-tool']);
  });
  it('returns [] for no tools', () => {
    expect(featurePhrasesForTools([])).toEqual([]);
  });
});
