import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import { unsubstitutedTemplateTokenRule } from './unsubstitutedTemplateToken.js';

describe('unsubstituted-template-token rule', () => {
  it('errors on a {{DATASOURCE}} ref in applied XML', () => {
    const xml =
      '<worksheet><table><rows>[{{DATASOURCE}}].[none:Region:nk]</rows></table></worksheet>';

    const issues = unsubstitutedTemplateTokenRule.validate(xml);

    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('unsubstituted-template-token');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toMatch(/\{\{DATASOURCE\}\}/);
    expect(issues[0].suggestion).toContain('build-worksheets-from-templates');
  });

  it('dedupes repeats of the same token', () => {
    const xml =
      '<x a="[{{DATASOURCE}}].[a]" b="[{{DATASOURCE}}].[b]"><rows>[{{DATASOURCE}}].[c]</rows></x>';

    expect(unsubstitutedTemplateTokenRule.validate(xml)).toHaveLength(1);
  });

  it('flags distinct template tokens separately', () => {
    const xml = '<x a="{{DATASOURCE}}" b="{{USER_NS}}" c="{{PLACEHOLDER}}"/>';

    expect(unsubstitutedTemplateTokenRule.validate(xml)).toHaveLength(3);
  });

  it('tolerates inner whitespace', () => {
    expect(
      unsubstitutedTemplateTokenRule.validate('<rows>[{{ DATASOURCE }}].[x]</rows>'),
    ).toHaveLength(1);
  });

  it('does not flag valid applied XML', () => {
    const xml = `<worksheet><table>
      <rows>[Sample - Superstore].[none:Region:nk]</rows>
      <cols>[Sample - Superstore].[sum:Profit:qk]</cols>
    </table></worksheet>`;

    expect(unsubstitutedTemplateTokenRule.validate(xml)).toHaveLength(0);
  });

  it('does not flag single-brace text, generic lowercase text, or the optional-field marker', () => {
    const xml =
      '<calc formula="IF {x} > 0 THEN &quot;a&quot; END" />' +
      '<x note="{not a token}" y="{{lower_case}}" optional="{{semantic field in plain English terms}}; original field [X]"/>';

    expect(unsubstitutedTemplateTokenRule.validate(xml)).toHaveLength(0);
  });

  it('errors on lowercase {{field_base_N}} residue without matching symbolic N', () => {
    const issues = unsubstitutedTemplateTokenRule.validate(
      '<worksheet><rows>[{{DATASOURCE}}].[{{field_base_2}}]</rows><x note="{{field_base_N}}"/></worksheet>',
    );

    expect(issues).toHaveLength(2);
    expect(issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('{{DATASOURCE}}'),
        expect.stringContaining('{{field_base_2}}'),
      ]),
    );
    expect(issues.some((issue) => issue.message.includes('{{field_base_N}}'))).toBe(false);
  });

  it('returns nothing for empty XML', () => {
    expect(unsubstitutedTemplateTokenRule.validate('')).toHaveLength(0);
    expect(unsubstitutedTemplateTokenRule.validate('<worksheet/>')).toHaveLength(0);
  });

  it('blocks workbook validation when registered', () => {
    const result = runValidation(
      '<workbook><rows>[{{DATASOURCE}}].[none:Region:nk]</rows></workbook>',
      'workbook',
    );

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.ruleId === 'unsubstituted-template-token')).toBe(true);
  });
});
