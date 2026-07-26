import { readFileSync } from 'fs';
import { join } from 'path';

const TEMPLATE_DIR = join(process.cwd(), 'src', 'desktop', 'data', 'templates');

function template(name: string): string {
  return readFileSync(join(TEMPLATE_DIR, `${name}.xml`), 'utf8');
}

// magnitude-simple-bar, part-to-whole-waterfall, and ranking-ordered-column also carry
// hardcoded Superstore computed-sort refs, but they are render-stamped: their bytes may
// only change through the factory golden-parity re-stamp flow. The parameterized versions
// (plus the waterfall label/gain-loss presentation defaults) are held on
// claude/stamped-template-polish; extend the table below when that branch re-earns its
// stamps and lands.
describe('computed-sort template parameters', () => {
  it.each([
    [
      'pareto-chart',
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
