import { replaceFieldReferences } from './replaceFieldReferences.js';

// Template uses {{DATASOURCE}} placeholders and template field names that the
// mapping rewrites to real field/datasource names.
function template(refs: string): string {
  return `<?xml version="1.0"?><worksheet><table><view>${refs}</view></table></worksheet>`;
}

describe('replaceFieldReferences', () => {
  it('rewrites a {{DATASOURCE}} field reference in text nodes', () => {
    const xml = template('<rows>[{{DATASOURCE}}].[none:TemplateField:nk]</rows>');
    const out = replaceFieldReferences(xml, { TemplateField: '[DS].[sum:Sales:qk]' }, 'My Data');
    // CONVERGENCE: the rebuilt instance NAME keeps the lowercase derivation short
    // code (`[sum:...]`) — the prior `[Sum:...]` assertion pinned the old
    // capitalize-into-the-name bug that fails to bind in live Desktop.
    expect(out).toContain('[My Data].[sum:Sales:qk]');
  });

  it('does not expand $-sequences in field names ($1, $&, $$)', () => {
    // A field named with regex replacement specials must be inserted literally.
    const xml = template('<rows>[{{DATASOURCE}}].[none:TemplateField:nk]</rows>');
    const out = replaceFieldReferences(
      xml,
      { TemplateField: '[DS].[sum:Net $1 $$ Total:qk]' },
      'My Data',
    );
    // CONVERGENCE: lowercase short code (`sum`), same as above; the $-literal
    // guarantee (the point of this test) is unchanged.
    expect(out).toContain('[My Data].[sum:Net $1 $$ Total:qk]');
  });

  it('does not expand $-sequences in the datasource name', () => {
    const xml = template('<rows>[{{DATASOURCE}}].[none:TemplateField:nk]</rows>');
    const out = replaceFieldReferences(
      xml,
      { TemplateField: '[DS].[sum:Sales:qk]' },
      'Sales $$ Co $1',
    );
    // CONVERGENCE: lowercase short code (`sum`); $-literal datasource unchanged.
    expect(out).toContain('[Sales $$ Co $1].[sum:Sales:qk]');
  });

  it('does not expand $-sequences when filling bare {{DATASOURCE}} placeholders', () => {
    const xml = template('<rows>[{{DATASOURCE}}].[none:Other:nk]</rows>');
    const out = replaceFieldReferences(xml, {}, 'A$$B$1');
    expect(out).toContain('[A$$B$1].[none:Other:nk]');
  });
});
