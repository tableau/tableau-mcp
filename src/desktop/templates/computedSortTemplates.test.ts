import { getRuntimeTemplateSnapshot } from './runtimeTemplateCatalog.js';

function template(name: string): string {
  const snapshot = getRuntimeTemplateSnapshot(name);
  if (!snapshot) throw new Error(`missing runtime template snapshot: ${name}`);
  return snapshot.xml;
}

// This exact computed-sort pin keeps each TBM-derived categorical `none` key and
// quantitative `sum` key attached to the intended raw placeholder position.
describe('computed-sort template parameters', () => {
  it.each([
    [
      'magnitude-simple-bar',
      "<computed-sort column='[{{DATASOURCE}}].[none:{{field_base_1}}:nk]' direction='DESC' using='[{{DATASOURCE}}].[sum:{{field_base_2}}:qk]' />",
    ],
    [
      'pareto-chart',
      "<computed-sort column='[{{DATASOURCE}}].[none:{{field_base_2}}:nk]' direction='DESC' using='[{{DATASOURCE}}].[sum:{{field_base_1}}:qk]' />",
    ],
    [
      'deviation-spine-chart',
      "<computed-sort column='[{{DATASOURCE}}].[none:{{field_base_1}}:nk]' direction='ASC' using='[{{DATASOURCE}}].[usr:Men (copy):qk]' />",
    ],
    [
      'ranking-ordered-column',
      "<computed-sort column='[{{DATASOURCE}}].[none:{{field_base_2}}:nk]' direction='DESC' using='[{{DATASOURCE}}].[sum:{{field_base_1}}:qk]' />",
    ],
    [
      'part-to-whole-waterfall',
      "<computed-sort column='[{{DATASOURCE}}].[none:{{field_base_2}}:nk]' direction='DESC' using='[{{DATASOURCE}}].[sum:{{field_base_1}}:qk]' />",
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
