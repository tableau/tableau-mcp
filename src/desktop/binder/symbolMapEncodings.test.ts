import { rewriteFieldReferences } from '../templates/fieldReferenceRewriter.js';
import { createPuppetCompatibilityProjection } from '../templates/puppetCompatibilityProjection.js';
import { loadRuntimeTemplateCatalogSnapshots } from '../templates/runtimeTemplateCatalog.js';
import { readTemplate } from '../templates/templatePath.js';
import { classifyNoLlm, summarizeSchema } from './binder.js';

const manifests = createPuppetCompatibilityProjection(
  loadRuntimeTemplateCatalogSnapshots(),
).descriptors;

const workbookXml = (datasource: string, columns: string): string => `<?xml version='1.0'?>
<workbook>
  <datasources>
    <datasource name='${datasource}'>
${columns}
    </datasource>
  </datasources>
</workbook>`;

const column = (
  name: string,
  role: 'dimension' | 'measure',
  type: 'nominal' | 'quantitative',
  datatype: 'string' | 'integer' | 'real',
  semanticRole?: string,
): string =>
  `      <column name='[${name}]' role='${role}' type='${type}' datatype='${datatype}'${semanticRole ? ` semantic-role='${semanticRole}'` : ''} />`;

const latlonXml = workbookXml(
  'Points',
  [
    column('Country', 'dimension', 'nominal', 'string'),
    column('Latitude', 'measure', 'quantitative', 'real'),
    column('Longitude', 'measure', 'quantitative', 'real'),
    column('Points', 'measure', 'quantitative', 'integer'),
  ].join('\n'),
);

const generatedGeoXml = workbookXml(
  'Points',
  [
    column('Country', 'dimension', 'nominal', 'string', '[Country].[Name]'),
    column('Points', 'measure', 'quantitative', 'integer'),
  ].join('\n'),
);

const cueNamedFieldXml = workbookXml(
  'Points',
  [
    column('Country', 'dimension', 'nominal', 'string', '[Country].[Name]'),
    column('Latitude', 'measure', 'quantitative', 'real'),
    column('Longitude', 'measure', 'quantitative', 'real'),
    column('Warm', 'measure', 'quantitative', 'integer'),
    column('Hover', 'measure', 'quantitative', 'integer'),
  ].join('\n'),
);

const liveShapedWorldCupXml = `<workbook><datasources><datasource name='federated.wc' caption='teams+'>
  <connection><relation name='players' /></connection>
  <column name='[country_code]' caption='Country Code' role='dimension' type='nominal' datatype='string' semantic-role='[Country].[ISO3166_2]' />
  <column name='[goals]' caption='Goals' role='measure' type='quantitative' datatype='integer' />
  <column name='[goals_for]' caption='Goals For' role='measure' type='quantitative' datatype='integer' />
  <column name='[goals_against]' caption='Goals Against' role='measure' type='quantitative' datatype='integer' />
  <column name='[latitude]' caption='Latitude' role='measure' type='quantitative' datatype='real' semantic-role='[Geographical].[Latitude]' aggregation='Avg' />
  <column name='[longitude]' caption='Longitude' role='measure' type='quantitative' datatype='real' semantic-role='[Geographical].[Longitude]' aggregation='Avg' />
</datasource></datasources><worksheets><worksheet name='se-eval-scratch' /></worksheets></workbook>`;

describe('classifyNoLlm — optional symbol-map encodings', () => {
  it('binds the exact lat/lon user ask to size and color without changing required slots', () => {
    const result = classifyNoLlm(
      'Build a symbol map using Latitude and Longitude with Country for detail. Put SUM(Points) on Size. Put SUM(Points) on Color. Put Country/Points on Tooltip.',
      manifests,
      summarizeSchema(latlonXml),
    );

    expect(result).not.toBeNull();
    expect(result!.template).toBe('spatial-symbol-map-latlon');
    expect(result!.bindings).toEqual(
      expect.arrayContaining([
        { slot_id: 'field_base_2', field: 'Longitude' },
        { slot_id: 'field_base_1', field: 'Latitude' },
        { slot_id: 'field_base_6', field: 'Country' },
        { slot_id: 'field_base_3', field: 'Points' },
        { slot_id: 'field_base_4', field: 'Points' },
        { slot_id: 'field_base_5', field: 'Points' },
      ]),
    );
  });

  it('binds generated geo with one semantic target and one size measure', () => {
    const result = classifyNoLlm(
      'Symbol map of Points by Country. Put SUM(Points) on Size. Put SUM(Points) on Color. Put Points on Tooltip.',
      manifests,
      summarizeSchema(generatedGeoXml),
    );

    expect(result).toEqual({
      template: 'spatial-symbol-map',
      bindings: [
        { slot_id: 'field_base_1', field: 'Points' },
        { slot_id: 'field_base_2', field: 'Country' },
      ],
      encodings: { filled: ['size'], unfilled: ['color', 'tooltip'] },
    });
  });

  it('reuses the size measure for natural color and hover cues in one lat/lon bind', () => {
    const result = classifyNoLlm(
      'Build a symbol map using Latitude and Longitude with Country for detail — bigger, warmer dots for Points, and show Country and Points when I hover.',
      manifests,
      summarizeSchema(latlonXml),
    );

    expect(result).toEqual({
      template: 'spatial-symbol-map-latlon',
      bindings: [
        { slot_id: 'field_base_2', field: 'Longitude' },
        { slot_id: 'field_base_1', field: 'Latitude' },
        { slot_id: 'field_base_6', field: 'Country' },
        { slot_id: 'field_base_3', field: 'Points' },
        { slot_id: 'field_base_4', field: 'Points' },
        { slot_id: 'field_base_5', field: 'Points' },
      ],
      encodings: { filled: ['size', 'color', 'tooltip'], unfilled: [] },
    });
  });

  it('keeps an explicit lat/lon color measure distinct from the size measure', () => {
    const result = classifyNoLlm(
      'Build a symbol map using Latitude and Longitude with Country for detail. Put Goals For on Size. Put Goals Against on Color.',
      manifests,
      summarizeSchema(liveShapedWorldCupXml),
    );

    expect(result).toEqual({
      template: 'spatial-symbol-map-latlon',
      bindings: [
        { slot_id: 'field_base_2', field: 'Longitude' },
        { slot_id: 'field_base_1', field: 'Latitude' },
        { slot_id: 'field_base_6', field: 'Country Code' },
        { slot_id: 'field_base_3', field: 'Goals For' },
        { slot_id: 'field_base_4', field: 'Goals Against' },
      ],
      encodings: { filled: ['size', 'color'], unfilled: [] },
    });
  });

  it.each(['Warm', 'Hover'])(
    'does not treat the matched %s field name as a natural encoding cue',
    (field) => {
      const result = classifyNoLlm(
        `Build a symbol map using Latitude and Longitude with Country for detail. Put ${field} on Size.`,
        manifests,
        summarizeSchema(cueNamedFieldXml),
      );

      expect(result).toEqual({
        template: 'spatial-symbol-map-latlon',
        bindings: [
          { slot_id: 'field_base_2', field: 'Longitude' },
          { slot_id: 'field_base_1', field: 'Latitude' },
          { slot_id: 'field_base_6', field: 'Country' },
          { slot_id: 'field_base_3', field },
        ],
        encodings: { filled: ['size'], unfilled: [] },
      });
    },
  );

  it('leaves optional encodings unbound when the ask gives no shelf instruction', () => {
    const result = classifyNoLlm(
      'Build a symbol map using Latitude and Longitude with Country for detail.',
      manifests,
      summarizeSchema(latlonXml),
    );

    expect(result).not.toBeNull();
    expect(result!.template).toBe('spatial-symbol-map-latlon');
    expect(result!.bindings).toEqual([
      { slot_id: 'field_base_2', field: 'Longitude' },
      { slot_id: 'field_base_1', field: 'Latitude' },
      { slot_id: 'field_base_6', field: 'Country' },
    ]);
  });

  it('renders a lat/lon template with optional encodings unbound', () => {
    const manifest = manifests.get('spatial-symbol-map-latlon')!;
    const currentTemplate = readTemplate('spatial-symbol-map-latlon')!;
    const runtimeMapping = {
      '{{field_base_2}}': '[Points].[avg:Longitude:qk]',
      '{{field_base_1}}': '[Points].[avg:Latitude:qk]',
      '{{field_base_6}}': '[Points].[none:Country:nk]',
      '{{field_base_7}}': '[Points].[none:City:nk]',
    };
    const rewrite = (template: string, mapping: Record<string, string>): string =>
      rewriteFieldReferences(template, mapping, 'Points', undefined, {
        templateSlots: manifest.slots,
      });

    const rendered = rewrite(currentTemplate, runtimeMapping);
    expect(rendered).not.toContain('<size ');
    expect(rendered).not.toContain('<color ');
    expect(rendered).not.toContain('<tooltip ');
    expect(rendered).not.toMatch(/\{\{field_base_[1-9]\d*\}\}/);
    expect(rendered).toContain('<rows>[Points].[avg:Latitude:qk]</rows>');
    expect(rendered).toContain('<cols>[Points].[avg:Longitude:qk]</cols>');
  });
});
