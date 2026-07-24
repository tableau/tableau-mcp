import fs from 'fs';
import path from 'path';

import {
  type AvailableFieldLike,
  bindExplicitTemplate,
  schemaSummaryFromAvailableFields,
} from '../binder/explicit-bind.js';
import { loadManifests } from '../binder/manifest.js';
import type { SlotSpec } from '../binder/manifest-types.js';
import { rewriteFieldReferences } from './fieldReferenceRewriter.js';

const XML_DIR = path.join(
  process.cwd(),
  'src',
  'desktop',
  'data',
  'data-visualization-templates-xml',
);
const DS = 'Portable Data';

const field = (
  name: string,
  role: 'dimension' | 'measure',
  type: 'nominal' | 'quantitative' | 'ordinal',
  datatype: 'string' | 'real' | 'date',
  derivation: 'none' | 'sum' | 'tmn',
): AvailableFieldLike => ({
  datasource: DS,
  columnName: `[${name}]`,
  role,
  type,
  datatype,
  column_ref: `[${DS}].[${derivation}:${name}:${type === 'quantitative' || derivation === 'tmn' ? 'qk' : 'nk'}]`,
});

interface Pilot {
  name: string;
  legacyFields: string[];
  bindings: Record<string, string>;
  fields: AvailableFieldLike[];
}

const pilots: Pilot[] = [
  {
    name: 'ranking-ordered-bar',
    legacyFields: ['Category', 'Measure', 'Facet'],
    bindings: {
      region: `[${DS}].[none:Segment:nk]`,
      sales: `[${DS}].[sum:Revenue:qk]`,
    },
    fields: [
      field('Segment', 'dimension', 'nominal', 'string', 'none'),
      field('Revenue', 'measure', 'quantitative', 'real', 'sum'),
    ],
  },
  {
    name: 'deviation-diverging-bar',
    legacyFields: ['Sub-Category', 'Profit', 'Sales'],
    bindings: {
      sub_category: `[${DS}].[none:Product:nk]`,
      profit: `[${DS}].[sum:Margin:qk]`,
      sales: `[${DS}].[sum:Revenue:qk]`,
    },
    fields: [
      field('Product', 'dimension', 'nominal', 'string', 'none'),
      field('Margin', 'measure', 'quantitative', 'real', 'sum'),
      field('Revenue', 'measure', 'quantitative', 'real', 'sum'),
    ],
  },
  {
    name: 'trend-line-chart',
    legacyFields: ['Order Date', 'Sales', 'Facet', 'Color Series'],
    bindings: {
      order_date: `[${DS}].[tmn:Event Date:qk]`,
      sales: `[${DS}].[sum:Revenue:qk]`,
    },
    fields: [
      field('Event Date', 'dimension', 'ordinal', 'date', 'tmn'),
      field('Revenue', 'measure', 'quantitative', 'real', 'sum'),
    ],
  },
];

function literalize(xml: string, legacyFields: string[]): string {
  return legacyFields.reduce(
    (out, legacy, index) =>
      out.replace(new RegExp(`\\{\\{field_base_${index + 1}\\}\\}`, 'g'), legacy),
    xml,
  );
}

function literalizeSlots(slots: SlotSpec[], legacyFields: string[]): SlotSpec[] {
  return slots.map((slot) => {
    const match = slot.template_field.match(/^\{\{field_base_(\d+)\}\}$/);
    return match
      ? { ...slot, template_field: legacyFields[Number(match[1]) - 1] }
      : structuredClone(slot);
  });
}

function literalizeMapping(
  mapping: Record<string, string>,
  legacyFields: string[],
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(mapping).map(([key, value]) => {
      const match = key.match(/^\{\{field_base_(\d+)\}\}(@.+)?$/);
      return match
        ? [`${legacyFields[Number(match[1]) - 1]}${match[2] ?? ''}`, value]
        : [key, value];
    }),
  );
}

describe.each(pilots)('placeholder pilot $name', (pilot) => {
  const manifests = loadManifests();
  const templateXml = fs.readFileSync(path.join(XML_DIR, `${pilot.name}.xml`), 'utf8');

  it('binds stable slot ids and substitutes to zero placeholder residue', () => {
    const bound = bindExplicitTemplate(
      pilot.name,
      pilot.bindings,
      schemaSummaryFromAvailableFields(pilot.fields),
      { manifests },
    );
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;

    const out = rewriteFieldReferences(
      templateXml,
      bound.fieldMapping,
      bound.datasource,
      bound.fieldMetadata,
      { templateSlots: bound.templateSlots },
    );

    expect(out).not.toMatch(/\{\{field_base_\d+\}\}/);
    expect(out).not.toContain('{{DATASOURCE}}');
  });

  it('produces byte-stable rewritten XML versus the legacy field-token form', () => {
    const bound = bindExplicitTemplate(
      pilot.name,
      pilot.bindings,
      schemaSummaryFromAvailableFields(pilot.fields),
      { manifests },
    );
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;

    const generic = rewriteFieldReferences(
      templateXml,
      bound.fieldMapping,
      bound.datasource,
      undefined,
      { templateSlots: bound.templateSlots },
    );
    const legacy = rewriteFieldReferences(
      literalize(templateXml, pilot.legacyFields),
      literalizeMapping(bound.fieldMapping, pilot.legacyFields),
      bound.datasource,
      undefined,
      { templateSlots: literalizeSlots(bound.templateSlots, pilot.legacyFields) },
    );

    expect(generic).toBe(legacy);
  });
});

describe('deviation-diverging-bar data portability', () => {
  it('contains no donor Region or Central filter in source or substituted output', () => {
    const pilot = pilots.find((candidate) => candidate.name === 'deviation-diverging-bar')!;
    const manifests = loadManifests();
    const templateXml = fs.readFileSync(path.join(XML_DIR, `${pilot.name}.xml`), 'utf8');
    const bound = bindExplicitTemplate(
      pilot.name,
      pilot.bindings,
      schemaSummaryFromAvailableFields(pilot.fields),
      { manifests },
    );
    expect(bound.ok).toBe(true);
    if (!bound.ok) return;

    const out = rewriteFieldReferences(
      templateXml,
      bound.fieldMapping,
      bound.datasource,
      undefined,
      {
        templateSlots: bound.templateSlots,
      },
    );

    for (const xml of [templateXml, out]) {
      expect(xml).not.toContain('Central');
      expect(xml).not.toMatch(/:Region:|\[Region\]/);
    }
  });
});
