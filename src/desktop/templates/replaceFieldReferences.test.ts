import { rewriteFieldReferences } from './fieldReferenceRewriter.js';

// W14-CM1 removed the thin `replaceFieldReferences` wrapper; both consumers now call
// the shared core (`rewriteFieldReferences`) directly. The wrapper was a pure
// passthrough, so this suite is retargeted onto the core verbatim to KEEP its unique
// coverage — the `$`-sequence literal guarantees (regex-replacement specials in field
// names / datasource names must be inserted literally, never expanded) that the core's
// own colocated suite does not otherwise pin.

// Template uses {{DATASOURCE}} placeholders and template field names that the
// mapping rewrites to real field/datasource names.
function template(refs: string): string {
  return `<?xml version="1.0"?><worksheet><table><view>${refs}</view></table></worksheet>`;
}

describe('rewriteFieldReferences — raw substitution ($-sequence literals)', () => {
  it('rewrites a {{DATASOURCE}} field reference in text nodes', () => {
    const xml = template('<rows>[{{DATASOURCE}}].[none:TemplateField:nk]</rows>');
    const out = rewriteFieldReferences(xml, { TemplateField: '[DS].[sum:Sales:qk]' }, 'My Data');
    // CONVERGENCE: the rebuilt instance NAME keeps the lowercase derivation short
    // code (`[sum:...]`) — the prior `[Sum:...]` assertion pinned the old
    // capitalize-into-the-name bug that fails to bind in live Desktop.
    expect(out).toContain('[My Data].[sum:Sales:qk]');
  });

  it('does not expand $-sequences in field names ($1, $&, $$)', () => {
    // A field named with regex replacement specials must be inserted literally.
    const xml = template('<rows>[{{DATASOURCE}}].[none:TemplateField:nk]</rows>');
    const out = rewriteFieldReferences(
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
    const out = rewriteFieldReferences(
      xml,
      { TemplateField: '[DS].[sum:Sales:qk]' },
      'Sales $$ Co $1',
    );
    // CONVERGENCE: lowercase short code (`sum`); $-literal datasource unchanged.
    expect(out).toContain('[Sales $$ Co $1].[sum:Sales:qk]');
  });

  it('does not expand $-sequences when filling bare {{DATASOURCE}} placeholders', () => {
    const xml = template('<rows>[{{DATASOURCE}}].[none:Other:nk]</rows>');
    const out = rewriteFieldReferences(xml, {}, 'A$$B$1');
    expect(out).toContain('[A$$B$1].[none:Other:nk]');
  });
});
