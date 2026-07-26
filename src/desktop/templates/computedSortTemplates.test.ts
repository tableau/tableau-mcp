import { readFileSync } from 'fs';
import { join } from 'path';

const TEMPLATE_DIR = join(process.cwd(), 'src', 'desktop', 'data', 'templates');

function template(name: string): string {
  return readFileSync(join(TEMPLATE_DIR, `${name}.xml`), 'utf8');
}

describe('computed-sort template parameters', () => {
  it.each([
    [
      'magnitude-simple-bar',
      "<computed-sort column='[{{DATASOURCE}}].[none:{{field_base_1}}:nk]' direction='DESC' using='[{{DATASOURCE}}].[sum:{{field_base_2}}:qk]' />",
    ],
    [
      'pareto-chart',
      "<computed-sort column='[{{DATASOURCE}}].[none:{{field_base_1}}:nk]' direction='DESC' using='[{{DATASOURCE}}].[sum:{{field_base_2}}:qk]' />",
    ],
    [
      'part-to-whole-waterfall',
      "<computed-sort column='[{{DATASOURCE}}].[none:{{field_base_2}}:nk]' direction='DESC' using='[{{DATASOURCE}}].[sum:{{field_base_1}}:qk]' />",
    ],
    [
      'ranking-ordered-column',
      "<computed-sort column='[{{DATASOURCE}}].[none:{{field_base_1}}:nk]' direction='DESC' using='[{{DATASOURCE}}].[sum:{{field_base_2}}:qk]' />",
    ],
    [
      'deviation-spine-chart',
      "<computed-sort column='[{{DATASOURCE}}].[none:{{field_base_1}}:nk]' direction='ASC' using='[{{DATASOURCE}}].[usr:Men (copy):qk]' />",
    ],
  ])('%s parameterizes its computed sort', (name, expected) => {
    expect(template(name)).toContain(expected);
  });

  it('removes the donor datasource id from deviation-spine-chart', () => {
    const xml = template('deviation-spine-chart');
    expect(xml).not.toContain('federated.1ko0q9z0cybhx212227b819gayqi');
    expect(xml).toContain("name='{{DATASOURCE}}'");
    expect(xml).toContain("datasource-dependencies datasource='{{DATASOURCE}}'");
  });
});

describe('part-to-whole-waterfall presentation defaults', () => {
  const xml = template('part-to-whole-waterfall');

  it('labels every mark with its step value', () => {
    expect(xml).toContain("<text column='[{{DATASOURCE}}].[sum:Profit:qk]' />");
    expect(xml).toContain("<format attr='mark-labels-show' value='true' />");
  });

  it('colors gains and losses with a template-owned boolean calculation', () => {
    expect(xml).toContain(
      "<column caption='Gain' datatype='boolean' name='[Calculation_767019348535836687]' role='dimension' type='nominal'>",
    );
    expect(xml).toContain("<calculation class='tableau' formula='SUM([Profit]) &gt;= 0' />");
    expect(xml).toContain(
      "<column-instance column='[Calculation_767019348535836687]' derivation='User' name='[usr:Calculation_767019348535836687:nk]'",
    );
    expect(xml).toContain(
      "<color column='[{{DATASOURCE}}].[usr:Calculation_767019348535836687:nk]' />",
    );
    expect(xml).not.toContain("<color column='[{{DATASOURCE}}].[sum:Profit:qk]' />");
  });
});
