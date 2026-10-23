import { describe, expect, it } from 'vitest';

import { parameterFieldOnShelfRule as rule } from './parameterFieldOnShelf.js';

describe('parameter-field-on-shelf rule', () => {
  it('errors on a Parameters field on rows', () => {
    const xml =
      '<worksheet name="Profit"><table><rows>[Parameters].[none:Parameter 4:nk]</rows></table></worksheet>';
    const issues = rule.validate(xml);
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('parameter-field-on-shelf');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toMatch(/\[Parameters\]\.\[none:Parameter 4:nk\]/);
    expect(issues[0].suggestion).toMatch(/parameter-actions/);
  });

  it('errors on a Parameters field on cols too', () => {
    const xml = '<worksheet><table><cols>[Parameters].[Parameter 1]</cols></table></worksheet>';
    const issues = rule.validate(xml);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('error');
  });

  it('does not flag a selector build with a real dimension on cols', () => {
    const xml = `<worksheet name="Profit"><table>
      <cols>[Sample - Superstore].[:Measure Names]</cols>
      <rows/>
    </table></worksheet>`;
    expect(rule.validate(xml)).toHaveLength(0);
  });

  it('does not flag a parameter referenced inside a calc dependency', () => {
    const xml = `<worksheet><table>
      <cols>[Sample - Superstore].[sum:Profit:qk]</cols>
    </table>
    <datasource-dependencies datasource="Parameters">
      <column caption="Period" name="[Parameter 1]" />
    </datasource-dependencies></worksheet>`;
    expect(rule.validate(xml)).toHaveLength(0);
  });

  it('does not flag a parameter as an action target', () => {
    const xml = `<dashboard><actions><edit-parameter-action>
      <params>
        <param name="source-field" value="[Sample - Superstore].[:Measure Names]" />
        <param name="target-parameter" value="[Parameters].[Parameter 1]" />
      </params>
    </edit-parameter-action></actions></dashboard>`;
    expect(rule.validate(xml)).toHaveLength(0);
  });

  it('dedupes a repeated bad ref and returns nothing for empty or clean XML', () => {
    const dup =
      '<worksheet><table><rows>[Parameters].[Parameter 1]</rows><cols>[Parameters].[Parameter 1]</cols></table></worksheet>';
    expect(rule.validate(dup)).toHaveLength(1);
    expect(rule.validate('')).toHaveLength(0);
    expect(rule.validate('<worksheet/>')).toHaveLength(0);
  });
});
