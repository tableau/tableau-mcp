import { readFileSync } from 'fs';
import { join } from 'path';

import { wellFormedXmlRule } from '../validation/rules/wellFormedXml.js';
import { rewriteFieldReferences } from './fieldReferenceRewriter.js';
import { ensureUserNamespace } from './injectTemplateCore.js';
import {
  spliceWaterfallAnchorFilter,
  type WaterfallAnchorFilterResult,
} from './waterfallAnchorFilter.js';

const WATERFALL_XML = readFileSync(
  join(process.cwd(), 'src', 'desktop', 'data', 'templates', 'part-to-whole-waterfall.xml'),
  'utf8',
);
const DS = 'P&L Data';

const baseMapping = {
  Profit: `[${DS}].[sum:amount:qk]`,
  'Sub-Category': `[${DS}].[none:line_item:nk]`,
};
const slots = [
  { template_field: 'Profit', required: true, bindable: true },
  { template_field: 'Sub-Category', required: true, bindable: true },
  { template_field: 'Anchor Category', required: false, bindable: true },
];

function apply(mapping: Record<string, string>): WaterfallAnchorFilterResult {
  const rewritten = rewriteFieldReferences(
    ensureUserNamespace(WATERFALL_XML),
    mapping,
    DS,
    undefined,
    { templateSlots: slots },
  );
  return spliceWaterfallAnchorFilter(rewritten, mapping);
}

describe('spliceWaterfallAnchorFilter', () => {
  it('is identity when anchor_category is unbound', () => {
    const rewritten = rewriteFieldReferences(
      ensureUserNamespace(WATERFALL_XML),
      baseMapping,
      DS,
      undefined,
      { templateSlots: slots },
    );

    expect(spliceWaterfallAnchorFilter(rewritten, baseMapping)).toEqual({
      ok: true,
      xml: rewritten,
    });
    expect(apply(baseMapping)).toEqual({ ok: true, xml: rewritten });
  });

  it('splices an exclude filter for subtotal and total rows when anchor_category is bound', () => {
    const result = apply({
      ...baseMapping,
      'Anchor Category': `[${DS}].[none:category:nk]`,
    });
    expect(result.ok).toBe(true);
    const out = result.xml;

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
    const result = apply({
      ...baseMapping,
      'Anchor Category': `[${DS}].[none:category:nk]`,
    });
    const out = result.xml.replace(/\{\{TITLE\}\}/g, 'P&amp;L Waterfall');

    expect(out).not.toContain('Anchor Category');
    expect(wellFormedXmlRule.validate(out)).toEqual([]);
  });

  it('reports why a requested anchor filter could not be spliced', () => {
    const templateWithoutDependencies = [
      "<worksheet xmlns:user='http://www.tableausoftware.com/xml/user'>",
      "<mark class='GanttBar' />",
      '<rows>[cum:sum:Profit:qk]</rows>',
      '</worksheet>',
    ].join('');

    expect(
      spliceWaterfallAnchorFilter(templateWithoutDependencies, {
        'Anchor Category': `[${DS}].[none:category:nk]`,
      }),
    ).toEqual({
      ok: false,
      xml: templateWithoutDependencies,
      reason: 'waterfall anchor filter: datasource dependencies are missing',
    });
  });
});
