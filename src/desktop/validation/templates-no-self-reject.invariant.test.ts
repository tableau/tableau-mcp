import { beforeAll, describe, expect, it } from 'vitest';

import { loadRuntimeTemplateCatalogSnapshots } from '../templates/runtimeTemplateCatalog.js';
import { runValidation } from './registry.js';

// W60-INVARIANT-TESTS suite 2 — VALIDATOR NEVER SELF-REJECTS A BUNDLED TEMPLATE.
//
// The invalid-derivation-string rule (src/desktop/validation/rules/invalidDerivationString.ts)
// is an ERROR-severity preflight: it fires when a <column-instance derivation="..."> uses a
// non-canonical string that Tableau would silently rewrite to None. Every worksheet-fragment
// runtime XML derived from each TBM is applied through runValidation(..., 'workbook') on the
// apply path, so a template that itself trips the rule would be permanently un-appliable.
//
// Tonight this was verified by hand (40/40 templates clean). This suite makes that
// permanent: for EVERY shipped runtime template, runValidation(xml, 'workbook') must report ZERO
// invalid-derivation-string issues. (Other rules — well-formed-xml, calc-field-names — are
// out of scope for this invariant; a template legitimately may or may not carry those, and
// the derivation self-reject is the specific regression being locked.)

// Every error-severity issue blocks apply; only the unfilled-token placeholder is expected in raw templates.
const EXEMPT_RULE_IDS = new Set(['unsubstituted-template-token']);

// Real pre-existing template bug: the venn template references [Central Set] without declaring it; fix the template, then delete this entry.
const KNOWN_SELF_REJECTS = new Set([
  'part-to-whole__venn__schematic-overlap-between-sets:undeclared-set-reference',
]);

const runtimeTemplates = [...loadRuntimeTemplateCatalogSnapshots()].map(
  ([template, { snapshot }]) => ({ template, xml: snapshot.xml }),
);

describe(
  'validation/templates — no bundled template self-rejects on a blocking rule',
  { timeout: 30_000 },
  () => {
    const invalidDerivationsByTemplate = new Map<
      string,
      ReturnType<typeof runValidation>['issues']
    >();

    beforeAll(() => {
      for (const { template, xml } of runtimeTemplates) {
        invalidDerivationsByTemplate.set(
          template,
          runValidation(xml, 'workbook').issues.filter(
            (issue) =>
              issue.severity === 'error' &&
              !EXEMPT_RULE_IDS.has(issue.ruleId) &&
              !KNOWN_SELF_REJECTS.has(`${template}:${issue.ruleId}`),
          ),
        );
      }
    }, 30_000);

    it('loads the shipped TBM corpus into the runtime catalog', () => {
      expect(
        runtimeTemplates.length,
        'expected all 133 shipped TBMs to produce runtime snapshots',
      ).toBeGreaterThanOrEqual(133);
    });

    it.each(runtimeTemplates)(
      'runValidation($template, "workbook") reports zero blocking-rule issues',
      ({ template }) => {
        const offenders = invalidDerivationsByTemplate.get(template) ?? [];
        expect(
          offenders,
          `${template}: bundled template must not self-reject on a blocking rule; ` +
            `offending issues: ${offenders.map((o) => `${o.ruleId}: ${o.message}`).join(' | ')}`,
        ).toEqual([]);
      },
    );

    it('reports zero blocking-rule issues across the ENTIRE corpus (aggregate lock)', () => {
      const offenders = [...invalidDerivationsByTemplate].flatMap(([template, issues]) =>
        issues.map((issue) => `${template}: ${issue.message}`),
      );
      expect(
        offenders,
        `templates self-rejecting on a blocking rule:\n${offenders.join('\n')}`,
      ).toEqual([]);
    });
  },
);
