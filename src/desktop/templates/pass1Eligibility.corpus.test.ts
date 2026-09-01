import { runValidation } from '../validation/registry.js';
import { bookmarkToTemplateWorkbook, deriveTemplatePass1Eligibility } from './bookmarkTemplate.js';
import { inferFromBookmark } from './inferSlots.js';
import { ensureUserNamespace } from './injectTemplateCore.js';
import { listBookmarkNames, readBookmark } from './templatePath.js';

const EXPECTED_EXCLUDED = [
  'correlation__category-heatmap__show-patterns-across-two-categorical-axes',
  'correlation__radar-profile__compare-multivariate-profiles',
  'deviation__diverging-stacked-bar__show-sentiment-or-likert-breakdown',
  'deviation-gain-loss-chart',
  'distribution__beeswarm__show-each-point-without-overlap-hiding-density',
  'distribution__dot-plot__show-min-max-or-range-across-categories',
  'flow__sankey__trace-volume-through-multi-stage-paths',
  'magnitude__parallel-coordinates__compare-entities-across-many-variables',
  'magnitude__pictogram__count-with-repeated-icons-whole-numbers-only',
  'magnitude__radar__compare-many-variables-for-one-or-few-entities',
  'magnitude__radial-bar__show-circular-relative-bars-or-progress',
  'part-to-whole__arc__schematic-hierarchical-breakdown-use-sparingly',
  'part-to-whole__marimekko__encode-share-with-both-width-and-height',
  'part-to-whole__polar-area__compare-parts-on-a-radial-axis',
  'part-to-whole__proportional-stacked-bar__show-size-and-share-together',
  'part-to-whole__venn__schematic-overlap-between-sets',
  'ranking__bump__track-rank-changes-across-many-periods',
  'ranking__slope-rank__show-rank-swaps-between-two-periods',
  'ranking-bump-chart',
  'spatial__scaled-cartogram__distort-geography-so-area-encodes-value',
  'ww-ou-arrow',
  'ww-ou-diff',
];

describe('bundled bookmark pass-1 eligibility', () => {
  // WHY: Full-suite CPU contention can push this all-bookmark validation sweep past Vitest's 5s default.
  it(
    'converts all 137 bookmarks and excludes only the 22 unsafe pass-1 templates',
    { timeout: 30_000 },
    () => {
      const names = listBookmarkNames();
      const excluded: string[] = [];
      const conversionErrors: string[] = [];
      const retainedMappedSourceAttrs: string[] = [];
      const unexpectedValidationErrors: string[] = [];

      for (const name of names) {
        try {
          const bookmark = readBookmark(name);
          if (bookmark === null) throw new Error('bookmark could not be read');
          const inference = inferFromBookmark(bookmark);
          const converted = bookmarkToTemplateWorkbook(bookmark, inference);
          if (!deriveTemplatePass1Eligibility(converted).pass1_eligible) {
            excluded.push(name);
            continue;
          }
          const validationXml = ensureUserNamespace(
            converted.xml.replace(/\{\{TITLE\}\}/g, 'Pass 1 Corpus Probe'),
          );
          const errors = runValidation(validationXml, 'workbook').issues.filter(
            (issue) =>
              issue.severity === 'error' &&
              // Mirror the production eligibility gate (isBindingResolvedPlaceholderError):
              // DATASOURCE, field_base_N, and ALL-CAPS literal template_parameters
              // ({{DIRECTION}}, {{DATE_MIN}}/{{DATE_MAX}}) are all filled at bind time,
              // so leaving them unsubstituted in a raw template is expected, not an error.
              !(
                issue.ruleId === 'unsubstituted-template-token' &&
                /\{\{(?:DATASOURCE|field_base_[1-9]\d*|[A-Z][A-Z0-9_]*)\}\}/.test(issue.message)
              ),
          );
          for (const issue of errors) {
            unexpectedValidationErrors.push(`${name}: ${issue.ruleId}: ${issue.message}`);
          }
          const addressingAttrs = [
            ...converted.xml.matchAll(/\b(?:field|ordering-field)='([^']*)'/g),
          ].map((match) => match[1]);
          for (const { sourceField } of inference.slots) {
            const escaped = sourceField.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const donorRef = new RegExp(`(?:^|[:\\[])${escaped}(?=[:\\]])`);
            if (addressingAttrs.some((value) => donorRef.test(value))) {
              retainedMappedSourceAttrs.push(`${name}: ${sourceField}`);
            }
          }
        } catch (error) {
          conversionErrors.push(
            `${name}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      expect(names).toHaveLength(137);
      expect(conversionErrors).toEqual([]);
      expect(retainedMappedSourceAttrs).toEqual([]);
      expect(unexpectedValidationErrors).toEqual([]);
      expect(excluded).toEqual(EXPECTED_EXCLUDED);
      expect(names.length - excluded.length).toBe(115);
    },
  );
});
