import { readFileSync } from 'fs';
import { join } from 'path';

import { wellFormedXmlRule } from '../validation/rules/wellFormedXml.js';
import { rewriteFieldReferences } from './fieldReferenceRewriter.js';
import { ensureUserNamespace } from './injectTemplateCore.js';
import { spliceWaterfallAnchorFilter } from './waterfallAnchorFilter.js';

const WATERFALL_XML = readFileSync(
  join(process.cwd(), 'src', 'desktop', 'data', 'templates', 'part-to-whole-waterfall.xml'),
  'utf8',
);
const DS = 'P&L Data';

const baseMapping = {
  Profit: `[${DS}].[sum:amount:qk]`,
  'Sub-Category': `[${DS}].[none:line_item:nk]`,
};

function apply(mapping: Record<string, string>): string {
  const rewritten = rewriteFieldReferences(ensureUserNamespace(WATERFALL_XML), mapping, DS);
  return spliceWaterfallAnchorFilter(rewritten, mapping);
}

describe('spliceWaterfallAnchorFilter', () => {
  it('is identity when anchor_category is unbound', () => {
    const rewritten = rewriteFieldReferences(ensureUserNamespace(WATERFALL_XML), baseMapping, DS);

    expect(spliceWaterfallAnchorFilter(rewritten, baseMapping)).toBe(rewritten);
    expect(apply(baseMapping)).toBe(rewritten);
  });

  it('splices an exclude filter for subtotal and total rows when anchor_category is bound', () => {
    const out = apply({
      ...baseMapping,
      'Anchor Category': `[${DS}].[none:category:nk]`,
    });

    expect(out).toContain(
      "<column datatype='string' name='[category]' role='dimension' type='nominal' />",
    );
    expect(out).toContain(
      "<column-instance column='[category]' derivation='None' name='[none:category:nk]' pivot='key' type='nominal' />",
    );
    expect(out).toContain(
      "<filter class='categorical' column='[P&amp;L Data].[none:category:nk]'>",
    );
    expect(out).toContain("<groupfilter function='except'");
    expect(out).toContain("member='&quot;subtotal&quot;'");
    expect(out).toContain("member='&quot;total&quot;'");
  });

  it('leaves no virtual Anchor Category residue and stays well formed', () => {
    const out = apply({
      ...baseMapping,
      'Anchor Category': `[${DS}].[none:category:nk]`,
    }).replace(/\{\{TITLE\}\}/g, 'P&amp;L Waterfall');

    expect(out).not.toContain('Anchor Category');
    expect(wellFormedXmlRule.validate(out)).toEqual([]);
  });
});
