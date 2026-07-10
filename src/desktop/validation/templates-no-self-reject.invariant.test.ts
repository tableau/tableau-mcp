import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { runValidation } from './registry.js';

// W60-INVARIANT-TESTS suite 2 — VALIDATOR NEVER SELF-REJECTS A BUNDLED TEMPLATE.
//
// The invalid-derivation-string rule (src/desktop/validation/rules/invalidDerivationString.ts)
// is an ERROR-severity preflight: it fires when a <column-instance derivation="..."> uses a
// non-canonical string that Tableau would silently rewrite to None. Every worksheet-fragment
// XML we SHIP is applied through runValidation(..., 'workbook') on the apply path, so a
// bundled template that itself trips the rule would be permanently un-appliable — the
// validator rejecting our own golden content.
//
// Tonight this was verified by hand (40/40 templates clean). This suite makes that
// permanent: for EVERY shipped template XML, runValidation(xml, 'workbook') must report ZERO
// invalid-derivation-string issues. (Other rules — well-formed-xml, calc-field-names — are
// out of scope for this invariant; a template legitimately may or may not carry those, and
// the derivation self-reject is the specific regression being locked.)

const XML_DIR = path.join(
  process.cwd(),
  'src',
  'desktop',
  'data',
  'data-visualization-templates-xml',
);

const xmlFiles = fs
  .readdirSync(XML_DIR)
  .filter((f) => f.endsWith('.xml'))
  .sort();

describe('validation/templates — no bundled template self-rejects on invalid-derivation-string', () => {
  it('discovers the shipped template XML corpus (44 post day-1 vendor sync)', () => {
    expect(
      xmlFiles.length,
      'expected the shipped template XML corpus to be non-empty',
    ).toBeGreaterThan(0);
    // Pin the count verified by hand tonight so a template added/removed without re-running
    // this invariant is caught (adjust deliberately when the corpus grows).
    expect(xmlFiles.length).toBe(44);
  });

  it.each(xmlFiles)(
    'runValidation(%s, "workbook") reports zero invalid-derivation-string issues',
    (file) => {
      const xml = fs.readFileSync(path.join(XML_DIR, file), 'utf8');
      const result = runValidation(xml, 'workbook');
      const offenders = result.issues.filter((i) => i.ruleId === 'invalid-derivation-string');
      expect(
        offenders,
        `${file}: bundled template must not self-reject on invalid-derivation-string; ` +
          `offending derivations: ${offenders.map((o) => o.message).join(' | ')}`,
      ).toEqual([]);
    },
  );

  it('reports zero invalid-derivation-string issues across the ENTIRE corpus (aggregate lock)', () => {
    const offenders: string[] = [];
    for (const file of xmlFiles) {
      const xml = fs.readFileSync(path.join(XML_DIR, file), 'utf8');
      for (const issue of runValidation(xml, 'workbook').issues) {
        if (issue.ruleId === 'invalid-derivation-string')
          offenders.push(`${file}: ${issue.message}`);
      }
    }
    expect(
      offenders,
      `templates self-rejecting on invalid-derivation-string:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
