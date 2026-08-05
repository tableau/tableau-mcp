import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveTemplateSnapshot } from './templateSlots.js';

const DATA_ROOT = join(process.cwd(), 'src', 'desktop', 'data');
const MARK_COLOR_FORMAT = /<format\b[^>]*\battr=['"]mark-color['"][^>]*>/;

const baselineTemplates = [
  'ranking-ordered-bar',
  'ranking-ordered-column',
  'magnitude-simple-bar',
] as const;

describe('basic single-series templates inherit Tableau mark color', () => {
  it.each(baselineTemplates)('raw templates/%s.tbm does not pin mark-color', (template) => {
    const xml = readFileSync(join(DATA_ROOT, 'templates', `${template}.tbm`), 'utf8');

    expect(xml).not.toMatch(MARK_COLOR_FORMAT);
  });

  it.each(baselineTemplates)(
    'resolved production artifact for %s does not pin mark-color',
    (template) => {
      const snapshot = resolveTemplateSnapshot(template);

      expect(
        snapshot,
        `${template} must resolve through the production template seam`,
      ).not.toBeNull();
      expect(snapshot!.artifact.xml).not.toMatch(MARK_COLOR_FORMAT);
    },
  );
});
