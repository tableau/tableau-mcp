import { readFileSync } from 'fs';
import { join } from 'path';

import { loadManifests } from '../binder/manifest.js';

const TEMPLATE_DIR = join(process.cwd(), 'src', 'desktop', 'data', 'templates');
const manifests = loadManifests();

function template(name: string): string {
  return readFileSync(join(TEMPLATE_DIR, `${name}.xml`), 'utf8');
}

// stampHash.invariant.test.ts only proves XML bytes match the recorded hash; a
// legitimate re-stamp could update that hash while silently dropping parameterization.
// This byte pin catches that, while each slot-kind expectation guards positional order.
describe('computed-sort template parameters', () => {
  it.each([
    [
      'magnitude-simple-bar',
      "<computed-sort column='[{{DATASOURCE}}].[none:{{field_base_1}}:nk]' direction='DESC' using='[{{DATASOURCE}}].[sum:{{field_base_2}}:qk]' />",
      'categorical',
    ],
    [
      'pareto-chart',
      "<computed-sort column='[{{DATASOURCE}}].[none:{{field_base_1}}:nk]' direction='DESC' using='[{{DATASOURCE}}].[sum:{{field_base_2}}:qk]' />",
      'categorical',
    ],
    [
      'deviation-spine-chart',
      "<computed-sort column='[{{DATASOURCE}}].[none:{{field_base_1}}:nk]' direction='ASC' using='[{{DATASOURCE}}].[usr:Men (copy):qk]' />",
      'categorical',
    ],
    [
      'ranking-ordered-column',
      "<computed-sort column='[{{DATASOURCE}}].[none:{{field_base_1}}:nk]' direction='DESC' using='[{{DATASOURCE}}].[sum:{{field_base_2}}:qk]' />",
      'categorical',
    ],
    [
      'part-to-whole-waterfall',
      "<computed-sort column='[{{DATASOURCE}}].[none:{{field_base_2}}:nk]' direction='DESC' using='[{{DATASOURCE}}].[sum:{{field_base_1}}:qk]' />",
      'quantitative',
    ],
  ])('%s parameterizes its computed sort', (name, expected, firstBindableKind) => {
    expect(template(name)).toContain(expected);
    expect(manifests.get(name)?.slots.filter((slot) => slot.bindable)[0]?.kind).toBe(
      firstBindableKind,
    );
  });

  it('removes the donor datasource id from deviation-spine-chart', () => {
    const xml = template('deviation-spine-chart');
    expect(xml).not.toContain('federated.1ko0q9z0cybhx212227b819gayqi');
    expect(xml).toContain("name='{{DATASOURCE}}'");
    expect(xml).toContain("datasource-dependencies datasource='{{DATASOURCE}}'");
  });
});
