import { bookmarkToTemplateWorkbook, deriveTemplatePass1Eligibility } from './bookmarkTemplate.js';
import { inferFromBookmark } from './inferSlots.js';
import { listBookmarkNames, readBookmark } from './templatePath.js';

const EXPECTED_EXCLUDED = [
  'distribution__beeswarm__show-each-point-without-overlap-hiding-density',
  'distribution__violin__show-full-density-shape-beyond-simple-summary',
  'flow__chord__show-two-way-flows-in-a-matrix',
  'magnitude__radial-bar__show-circular-relative-bars-or-progress',
  'part-to-whole__arc__schematic-hierarchical-breakdown-use-sparingly',
  'part-to-whole__polar-area__compare-parts-on-a-radial-axis',
  'spatial__spike-map__show-magnitude-at-locations-with-height',
  'ww-ou-arrow',
  'ww-ou-diff',
];

describe('bundled bookmark pass-1 eligibility', () => {
  it('converts all 133 bookmarks and excludes only the 9 unresolved bare-ref templates', () => {
    const names = listBookmarkNames();
    const excluded: string[] = [];
    const conversionErrors: string[] = [];

    for (const name of names) {
      try {
        const bookmark = readBookmark(name);
        if (bookmark === null) throw new Error('bookmark could not be read');
        const converted = bookmarkToTemplateWorkbook(bookmark, inferFromBookmark(bookmark));
        if (!deriveTemplatePass1Eligibility(converted).pass1_eligible) excluded.push(name);
      } catch (error) {
        conversionErrors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    expect(names).toHaveLength(133);
    expect(conversionErrors).toEqual([]);
    expect(excluded).toEqual(EXPECTED_EXCLUDED);
    expect(names.length - excluded.length).toBe(124);
  });
});
