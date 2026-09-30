import { describe, expect, it } from 'vitest';

import { runValidation } from '../registry.js';
import { tooltipDimensionRequiresAttrRule } from './tooltipDimensionRequiresAttr.js';

/**
 * P0 (GUS W-23447711, Lee Graber dogfood 2026-07-14): a none:/derivation="None"
 * dimension on <tooltip> in an aggregated view applies "successfully", then the
 * sheet renders blank with "cannot be converted to a measure using ATTR()" — the
 * only confirmed green-trace/failed-outcome shape in the dogfood backlog. Tooltip
 * is grain-neutral, so Tableau must ATTR()-wrap raw dimensions there; the authored
 * none: instance defeats that. The rule fires ONLY on tooltip (text/label join the
 * view grain, so none: is legitimate there) and ONLY in aggregated views.
 */

function ws({
  tooltipRef = '[DS].[none:Segment:nk]',
  rows = '[DS].[none:Region:nk]',
  cols = '[DS].[sum:Sales:qk]',
  encodingTag = 'tooltip',
}: {
  tooltipRef?: string;
  rows?: string;
  cols?: string;
  encodingTag?: string;
} = {}): string {
  return `<worksheet name="W"><table>
    <view>
      <datasource-dependencies datasource="DS">
        <column name="[Segment]" role="dimension" type="nominal" datatype="string" />
        <column-instance column="[Segment]" derivation="None" name="[none:Segment:nk]" pivot="key" type="nominal" />
        <column name="[Region]" role="dimension" type="nominal" datatype="string" />
        <column-instance column="[Region]" derivation="None" name="[none:Region:nk]" pivot="key" type="nominal" />
        <column name="[Sales]" role="measure" type="quantitative" datatype="real" />
        <column-instance column="[Sales]" derivation="Sum" name="[sum:Sales:qk]" pivot="key" type="quantitative" />
      </datasource-dependencies>
    </view>
    <panes><pane><mark class="Bar"/><encodings><${encodingTag} column="${tooltipRef}"/></encodings></pane></panes>
    <rows>${rows}</rows>
    <cols>${cols}</cols>
  </table></worksheet>`;
}

describe('tooltip-dimension-requires-attr rule', () => {
  it('errors on a none: dimension tooltip in an aggregated worksheet (the W-23447711 shape)', () => {
    const issues = tooltipDimensionRequiresAttrRule.validate(ws());
    expect(issues.length).toBe(1);
    expect(issues[0].ruleId).toBe('tooltip-dimension-requires-attr');
    expect(issues[0].severity).toBe('error');
    expect(issues[0].message).toContain('[DS].[none:Segment:nk]');
    expect(issues[0].message).toContain('cannot be converted to a measure using ATTR()');
    expect(issues[0].message).toContain('FIX:');
    expect(issues[0].message).toContain('[DS].[attr:Segment:nk]');
  });

  it('blocks validation when registered and the broken shape is present', () => {
    const result = runValidation(ws(), 'worksheet');
    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (issue) => issue.ruleId === 'tooltip-dimension-requires-attr' && issue.severity === 'error',
      ),
    ).toBe(true);
  });

  it('does not fire when the tooltip dimension is already an attr: instance', () => {
    expect(
      tooltipDimensionRequiresAttrRule.validate(ws({ tooltipRef: '[DS].[attr:Segment:nk]' })),
    ).toEqual([]);
  });

  it('does not fire when the tooltip carries a measure aggregate', () => {
    expect(
      tooltipDimensionRequiresAttrRule.validate(ws({ tooltipRef: '[DS].[sum:Sales:qk]' })),
    ).toEqual([]);
  });

  it('does not fire in a disaggregated view (no aggregate refs anywhere)', () => {
    const issues = tooltipDimensionRequiresAttrRule.validate(
      ws({ cols: '[DS].[none:Region:nk]', rows: '' }),
    );
    expect(issues).toEqual([]);
  });

  it('does not fire for none: dimensions on TEXT (text joins the view grain — legitimate)', () => {
    expect(tooltipDimensionRequiresAttrRule.validate(ws({ encodingTag: 'text' }))).toEqual([]);
  });

  it('skips none:...:qk refs (bins / exact-date quantitative instances)', () => {
    expect(
      tooltipDimensionRequiresAttrRule.validate(ws({ tooltipRef: '[DS].[none:Sales (bin):qk]' })),
    ).toEqual([]);
  });

  it('dedupes repeated identical tooltip refs to one issue', () => {
    const xml = ws().replace(
      '</encodings>',
      '<tooltip column="[DS].[none:Segment:nk]"/></encodings>',
    );
    expect(tooltipDimensionRequiresAttrRule.validate(xml).length).toBe(1);
  });
});
