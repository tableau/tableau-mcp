import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import { placeholderDatasourceRefRule } from './placeholderDatasourceRef.js';

describe('placeholder-datasource-ref rule', () => {
  it('errors on the [DS] placeholder in a computed-sort', () => {
    const xml =
      '<worksheet><computed-sort column="[DS].[none:Sub-Category:nk]" direction="DESC" using="[DS].[sum:Profit:qk]"/></worksheet>';

    const issues = placeholderDatasourceRefRule.validate(xml);

    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('placeholder-datasource-ref');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toMatch(/\[DS\]/);
    expect(issues[0].suggestion).toMatch(/real datasource|Sample - Superstore/);
  });

  it('is case-insensitive and flags other placeholder spellings', () => {
    expect(
      placeholderDatasourceRefRule.validate('<x><rows>[ds].[none:Region:nk]</rows></x>'),
    ).toHaveLength(1);
    expect(
      placeholderDatasourceRefRule.validate('<x a="[Datasource].[sum:Sales:qk]"/>'),
    ).toHaveLength(1);
    expect(
      placeholderDatasourceRefRule.validate('<x a="[Data Source].[sum:Sales:qk]"/>'),
    ).toHaveLength(1);
  });

  it('flags distinct placeholder tokens separately', () => {
    const xml = '<x a="[DS].[sum:A:qk]" b="[Datasource].[sum:B:qk]"/>';

    expect(placeholderDatasourceRefRule.validate(xml)).toHaveLength(2);
  });

  it('does not flag a real datasource reference', () => {
    const xml = `<worksheet>
      <cols>[Sample - Superstore].[sum:Profit:qk]</cols>
      <computed-sort column="[Sample - Superstore].[none:Sub-Category:nk]" direction="DESC" using="[Sample - Superstore].[sum:Profit:qk]"/>
    </worksheet>`;

    expect(placeholderDatasourceRefRule.validate(xml)).toHaveLength(0);
  });

  it('does not flag real datasource names that contain DS or a field named DS', () => {
    expect(
      placeholderDatasourceRefRule.validate('<x a="[DS Orders].[sum:Sales:qk]"/>'),
    ).toHaveLength(0);
    expect(
      placeholderDatasourceRefRule.validate('<x a="[federated.40738].[sum:Sales:qk]"/>'),
    ).toHaveLength(0);
    expect(
      placeholderDatasourceRefRule.validate('<x a="[Sample - Superstore].[none:DS:nk]"/>'),
    ).toHaveLength(0);
  });

  it('returns nothing for empty or clean XML', () => {
    expect(placeholderDatasourceRefRule.validate('')).toHaveLength(0);
    expect(placeholderDatasourceRefRule.validate('<worksheet/>')).toHaveLength(0);
  });

  it('blocks worksheet validation when registered', () => {
    const result = runValidation(
      '<worksheet><rows>[DS].[none:Region:nk]</rows></worksheet>',
      'worksheet',
    );

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.ruleId === 'placeholder-datasource-ref')).toBe(true);
  });
});
