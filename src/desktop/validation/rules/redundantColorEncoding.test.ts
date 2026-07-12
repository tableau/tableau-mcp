import { describe, expect, it } from 'vitest';

import { redundantColorEncodingRule } from './redundantColorEncoding.js';

function ws(
  colorRef: string,
  colRef = '[DS].[sum:Profit:qk]',
  rowRef = '[DS].[none:Sub-Category:nk]',
): string {
  return `<worksheet name="W"><table>
    <panes><pane><mark class="Bar"/><encodings><color column="${colorRef}"/></encodings></pane></panes>
    <rows>${rowRef}</rows>
    <cols>${colRef}</cols>
  </table></worksheet>`;
}

describe('redundant-color-encoding rule', () => {
  it('flags color by the same field already on cols', () => {
    const issues = redundantColorEncodingRule.validate(ws('[DS].[sum:Profit:qk]'));
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe('redundant-color-encoding');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toMatch(/\[DS\]\.\[sum:Profit:qk\]/);
    expect((issues[0].suggestion ?? '').toLowerCase()).toMatch(/discrete|group|tier/);
  });

  it('flags color by the same field already on rows', () => {
    const issues = redundantColorEncodingRule.validate(
      ws('[DS].[none:Sub-Category:nk]', '[DS].[sum:Profit:qk]', '[DS].[none:Sub-Category:nk]'),
    );
    expect(issues).toHaveLength(1);
  });

  it('does not flag a gradient by a different measure', () => {
    expect(redundantColorEncodingRule.validate(ws('[DS].[sum:Sales:qk]'))).toHaveLength(0);
  });

  it('does not flag color by a discrete tier calc', () => {
    expect(redundantColorEncodingRule.validate(ws('[DS].[none:Performance Group:nk]'))).toHaveLength(0);
  });

  it('does not flag when there is no color encoding', () => {
    const noColor = `<worksheet name="W"><table>
      <panes><pane><mark class="Bar"/><encodings/></pane></panes>
      <rows>[DS].[none:Sub-Category:nk]</rows><cols>[DS].[sum:Profit:qk]</cols></table></worksheet>`;
    expect(redundantColorEncodingRule.validate(noColor)).toHaveLength(0);
  });

  it('returns [] on unparseable XML rather than throwing', () => {
    expect(redundantColorEncodingRule.validate('<not-xml')).toEqual([]);
  });
});
