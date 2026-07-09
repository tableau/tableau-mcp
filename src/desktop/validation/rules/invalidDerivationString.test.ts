import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import { CANONICAL_DERIVATIONS, invalidDerivationStringRule } from './invalidDerivationString.js';

/**
 * Build a minimal, well-formed workbook containing a single <column-instance>
 * carrying the given derivation attribute.
 */
function workbookWithDerivation(
  derivation: string,
  name = `[${derivation}:Order Date:qk]`,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <worksheets>
    <worksheet name="Sheet 1">
      <table>
        <view>
          <datasource-dependencies datasource="ds">
            <column-instance name="${name}" column="[Order Date]"
                             derivation="${derivation}" pivot="key" type="quantitative" />
          </datasource-dependencies>
        </view>
      </table>
    </worksheet>
  </worksheets>
</workbook>`;
}

describe('invalid-derivation-string rule', () => {
  it.each([
    ['None'],
    ['Attribute'],
    ['Year'],
    ['Year-Trunc'],
    ['Month-Trunc'],
    ['Sum'],
    ['Avg'],
    ['CountD'],
    ['StdevP'],
    ['User'],
    ['ISO-Week'],
  ])('does not fire on the canonical derivation "%s"', (good) => {
    expect(invalidDerivationStringRule.validate(workbookWithDerivation(good))).toHaveLength(0);
  });

  it('rejects the invalid derivation "TruncMonth" naming the rule and canonical fix', () => {
    const issues = invalidDerivationStringRule.validate(workbookWithDerivation('TruncMonth'));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].ruleId).toBe('invalid-derivation-string');
    // Names the offending value and explains the silent rewrite to None.
    expect(issues[0].message).toContain('TruncMonth');
    expect(issues[0].message.toLowerCase()).toContain('none');
    // Carries the canonical fix.
    expect(issues[0].message).toContain('Month-Trunc');
    expect(issues[0].suggestion).toContain('Month-Trunc');
  });

  it.each([
    ['Attr', 'Attribute'],
    ['TruncYear', 'Year-Trunc'],
    ['TruncDay', 'Day-Trunc'],
    ['TruncQuarter', 'Quarter-Trunc'],
    ['TruncatedToYear', 'Year-Trunc'],
  ])('errors on look-alike "%s" and suggests canonical "%s"', (bad, canonical) => {
    const issues = invalidDerivationStringRule.validate(workbookWithDerivation(bad));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].suggestion).toContain(canonical);
  });

  it('errors on an unknown invalid derivation with a generic canonical hint', () => {
    const issues = invalidDerivationStringRule.validate(workbookWithDerivation('Wat'));
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
    expect(issues[0].suggestion).toContain('canonical');
  });

  it('de-duplicates repeated instances of the same invalid derivation', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <worksheets>
    <worksheet name="Sheet 1">
      <table><view>
        <datasource-dependencies datasource="ds">
          <column-instance name="[TruncMonth:Order Date:qk]" column="[Order Date]"
                           derivation="TruncMonth" pivot="key" type="quantitative" />
          <column-instance name="[TruncMonth:Ship Date:qk]" column="[Ship Date]"
                           derivation="TruncMonth" pivot="key" type="quantitative" />
        </datasource-dependencies>
      </view></table>
    </worksheet>
  </worksheets>
</workbook>`;
    expect(invalidDerivationStringRule.validate(xml)).toHaveLength(1);
  });

  it('ignores column-instances without a derivation attribute', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workbook>
  <worksheets>
    <worksheet name="Sheet 1">
      <table><view>
        <datasource-dependencies datasource="ds">
          <column-instance name="[none:Region:nk]" column="[Region]" pivot="key" type="nominal" />
        </datasource-dependencies>
      </view></table>
    </worksheet>
  </worksheets>
</workbook>`;
    expect(invalidDerivationStringRule.validate(xml)).toHaveLength(0);
  });

  it('exposes the canonical allowlist as a shared constant', () => {
    expect(CANONICAL_DERIVATIONS.has('Year-Trunc')).toBe(true);
    expect(CANONICAL_DERIVATIONS.has('CountD')).toBe(true);
    expect(CANONICAL_DERIVATIONS.has('User')).toBe(true);
    expect(CANONICAL_DERIVATIONS.has('Attr')).toBe(false);
    expect(CANONICAL_DERIVATIONS.has('TruncMonth')).toBe(false);
  });
});

describe('invalid-derivation-string rule — registered in the default apply preflight', () => {
  it('blocks a workbook apply when an invalid derivation is present', () => {
    const result = runValidation(workbookWithDerivation('TruncMonth'), 'workbook');
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => i.ruleId === 'invalid-derivation-string' && i.severity === 'error'),
    ).toBe(true);
  });

  it('blocks a worksheet apply when an invalid derivation is present', () => {
    const result = runValidation(workbookWithDerivation('TruncMonth'), 'worksheet');
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => i.ruleId === 'invalid-derivation-string' && i.severity === 'error'),
    ).toBe(true);
  });

  it('allows a workbook apply when all derivations are canonical', () => {
    const result = runValidation(workbookWithDerivation('Month-Trunc'), 'workbook');
    expect(result.issues.some((i) => i.ruleId === 'invalid-derivation-string')).toBe(false);
  });
});
