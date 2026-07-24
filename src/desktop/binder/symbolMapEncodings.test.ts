import { readFileSync } from 'fs';
import { join } from 'path';

import { rewriteFieldReferences } from '../templates/fieldReferenceRewriter.js';
import { bindTemplate, classifyNoLlm, summarizeSchema } from './binder.js';
import { computeFixtureBind, loadBinderFixture, loadManifests } from './manifest.js';

const manifests = loadManifests();

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

const PRE_ENCODING_LATLON_TEMPLATE = `<workbook>
  <worksheets>
    <worksheet name='{{TITLE}}'>
  <table>
    <view>
      <datasources>
        <datasource name='{{DATASOURCE}}' />
      </datasources>
      <mapsources>
        <mapsource name='Tableau' />
      </mapsources>
      <datasource-dependencies datasource='{{DATASOURCE}}'>
        <column datatype='real' name='[Latitude]' role='measure' type='quantitative' />
        <column datatype='real' name='[Longitude]' role='measure' type='quantitative' />
        <column datatype='string' name='[Detail1]' role='dimension' type='nominal' />
        <column datatype='string' name='[Detail2]' role='dimension' type='nominal' />
        <column-instance column='[Latitude]' derivation='Avg' name='[avg:Latitude:qk]' pivot='key' type='quantitative' />
        <column-instance column='[Longitude]' derivation='Avg' name='[avg:Longitude:qk]' pivot='key' type='quantitative' />
        <column-instance column='[Detail1]' derivation='None' name='[none:Detail1:nk]' pivot='key' type='nominal' />
        <column-instance column='[Detail2]' derivation='None' name='[none:Detail2:nk]' pivot='key' type='nominal' />
      </datasource-dependencies>
      <aggregation value='true' />
    </view>
    <style>
      <style-rule element='map'>
        <format attr='washout' value='0.0' />
        <format attr='map-snap-zoom' value='true' />
      </style-rule>
    </style>
    <panes>
      <pane selection-relaxation-option='selection-relaxation-disallow'>
        <view>
          <breakdown value='auto' />
        </view>
        <mark class='Circle' />
        <mark-sizing mark-sizing-setting='marks-scaling-off' />
        <encodings>
          <lod column='[{{DATASOURCE}}].[none:Detail1:nk]' />
          <lod column='[{{DATASOURCE}}].[none:Detail2:nk]' />
        </encodings>
        <style>
          <style-rule element='mark'>
            <format attr='mark-transparency' value='170' />
            <format attr='has-stroke' value='true' />
            <format attr='stroke-color' value='#b4b4b4' />
            <format attr='mark-color' value='#4e79a7' />
            <format attr='size' value='1.5932043790817261' />
          </style-rule>
        </style>
      </pane>
    </panes>
    <rows>[{{DATASOURCE}}].[avg:Latitude:qk]</rows>
    <cols>[{{DATASOURCE}}].[avg:Longitude:qk]</cols>
  </table>
  <simple-id uuid='00000000-0000-0000-0000-000000000001' />
</worksheet>
  </worksheets>
  <windows>
    <window class='worksheet' name='{{TITLE}}'>
  <viewpoint>
    <zoom type='entire-view' />
  </viewpoint>
  <simple-id uuid='00000000-0000-0000-0000-000000000002' />
</window>
  </windows>
</workbook>
`;

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
        { slot_id: 'longitude', field: 'Longitude' },
        { slot_id: 'latitude', field: 'Latitude' },
        { slot_id: 'detail1', field: 'Country' },
        { slot_id: 'size', field: 'Points' },
        { slot_id: 'color', field: 'Points' },
        { slot_id: 'tooltip', field: 'Points' },
      ]),
    );
  });

  it('binds explicit size, color, and tooltip shelves on the generated-geo symbol map', () => {
    const result = classifyNoLlm(
      'Symbol map of Points by Country. Put SUM(Points) on Size. Put SUM(Points) on Color. Put Points on Tooltip.',
      manifests,
      summarizeSchema(generatedGeoXml),
    );

    expect(result).not.toBeNull();
    expect(result!.template).toBe('spatial-symbol-map');
    expect(result!.bindings).toEqual([
      { slot_id: 'country', field: 'Country' },
      { slot_id: 'sales', field: 'Points' },
      { slot_id: 'color', field: 'Points' },
      { slot_id: 'tooltip', field: 'Points' },
    ]);
  });

  it('leaves optional encodings unbound when the ask gives no shelf instruction', () => {
    const result = classifyNoLlm(
      'Build a symbol map using Latitude and Longitude with Country for detail.',
      manifests,
      summarizeSchema(latlonXml),
    );

    expect(result).not.toBeNull();
    expect(result!.template).toBe('spatial-symbol-map-latlon');
    expect(result!.bindings).toEqual([
      { slot_id: 'longitude', field: 'Longitude' },
      { slot_id: 'latitude', field: 'Latitude' },
      { slot_id: 'detail1', field: 'Country' },
    ]);
  });

  it('accepts a categorical field on color and tooltip with none derivation', async () => {
    const result = await bindTemplate({
      ask: 'Symbol map of Points by Country. Put Country on Color. Put Country on Tooltip.',
      workbookXml: generatedGeoXml,
      manifests,
    });

    expect(result.status).toBe('bound');
    if (result.status !== 'bound') throw new Error(`expected bound, got ${result.status}`);
    expect(result.args.field_mapping).toMatchObject({
      '{{field_base_1}}': '[Points].[none:Country:nk]',
      '{{field_base_2}}': '[Points].[none:Country:nk]',
    });
  });

  it('renders an unbound GREEN lat/lon template byte-identically to its pre-encoding XML', () => {
    const manifest = manifests.get('spatial-symbol-map-latlon')!;
    const currentTemplate = readFileSync(
      join(process.cwd(), 'src/desktop/data/templates/spatial-symbol-map-latlon.xml'),
      'utf-8',
    );
    const mapping = {
      Longitude: '[Points].[avg:Longitude:qk]',
      Latitude: '[Points].[avg:Latitude:qk]',
      Detail1: '[Points].[none:Country:nk]',
    };
    const rewrite = (template: string): string =>
      rewriteFieldReferences(template, mapping, 'Points', undefined, {
        templateSlots: manifest.slots,
      });

    const rendered = rewrite(currentTemplate);
    expect(rendered).not.toContain('<size ');
    expect(rendered).not.toContain('<color ');
    expect(rendered).not.toContain('<tooltip ');
    expect(rendered).toBe(rewrite(PRE_ENCODING_LATLON_TEMPLATE));
  });

  it('keeps fixture eligibility and fast-path flags unchanged', () => {
    const fixture = loadBinderFixture();
    for (const template of ['spatial-symbol-map-latlon', 'spatial-symbol-map']) {
      const manifest = manifests.get(template)!;
      expect(computeFixtureBind(manifest, fixture.fields), template).toBe(true);
      expect(manifest.portability_evidence.fixture_bind, template).toBe(true);
      expect(manifest.fast_path_eligible, template).toBe(true);
    }
  });
});
