import { rewriteFieldReferences } from '../templates/fieldReferenceRewriter.js';
import { createPuppetCompatibilityProjection } from '../templates/puppetCompatibilityProjection.js';
import {
  getRuntimeTemplateSnapshot,
  loadRuntimeTemplateCatalogSnapshots,
} from '../templates/runtimeTemplateCatalog.js';
import { bindTemplate, classifyNoLlm, summarizeSchema } from './binder.js';
import type { RuntimeTemplateDescriptor } from './manifest-types.js';

const symbolMap: RuntimeTemplateDescriptor = {
  template: 'spatial-symbol-map',
  family: 'spatial',
  fast_path_eligible: true,
  fast_path_blockers: [],
  intent_keywords: ['symbol-map', 'map', 'spatial'],
  description: 'point map sized by a measure',
  slots: [
    {
      slot_id: 'country',
      template_field: 'Country/Region',
      derivation: 'none',
      role: ['lod'],
      kind: 'geo',
      bindable: true,
      required: true,
    },
    {
      slot_id: 'state',
      template_field: 'State/Province',
      derivation: 'none',
      role: ['lod'],
      kind: 'geo',
      bindable: true,
      required: false,
    },
    {
      slot_id: 'city',
      template_field: 'City',
      derivation: 'none',
      role: ['lod'],
      kind: 'geo',
      bindable: true,
      required: false,
    },
    {
      slot_id: 'sales',
      template_field: 'Sales',
      derivation: 'sum',
      role: ['size'],
      kind: 'quantitative',
      bindable: true,
      required: true,
    },
    {
      slot_id: 'color',
      template_field: '{{field_base_1}}',
      derivation: 'sum',
      role: ['color'],
      kind: 'quantitative-or-categorical',
      bindable: true,
      required: false,
    },
    {
      slot_id: 'tooltip',
      template_field: '{{field_base_2}}',
      derivation: 'sum',
      role: ['tooltip'],
      kind: 'quantitative-or-categorical',
      bindable: true,
      required: false,
    },
  ],
  calcs: [],
};
const manifests = new Map([[symbolMap.template, symbolMap]]);
const runtimeManifests = createPuppetCompatibilityProjection(
  loadRuntimeTemplateCatalogSnapshots(),
).descriptors;

/** The live-shaped World Cup schema Matt hit the flat-blue symbol map against. */
const worldCupXml = `<workbook><datasources><datasource name='federated.wc' caption='teams+'>
  <connection><relation name='players' /></connection>
  <column name='[country_code]' caption='Country Code' role='dimension' type='nominal' datatype='string' semantic-role='[Country].[ISO3166_2]' />
  <column name='[goals]' caption='Goals' role='measure' type='quantitative' datatype='integer' />
  <column name='[goals_for]' caption='Goals For' role='measure' type='quantitative' datatype='integer' />
  <column name='[goals_against]' caption='Goals Against' role='measure' type='quantitative' datatype='integer' />
</datasource></datasources><worksheets><worksheet name='se-eval-scratch' /></worksheets></workbook>`;

/** Fields whose NAMES contain the cue words, so a cue must not be read out of a field name. */
const cueNamedFieldXml = `<workbook><datasources><datasource name='Points'>
  <column name='[Country]' role='dimension' type='nominal' datatype='string' semantic-role='[Country].[Name]' />
  <column name='[Warm]' role='measure' type='quantitative' datatype='integer' />
  <column name='[Hover]' role='measure' type='quantitative' datatype='integer' />
</datasource></datasources></workbook>`;

const latlonXml = `<workbook><datasources><datasource name='Points'>
  <column name='[Country]' role='dimension' type='nominal' datatype='string' />
  <column name='[City]' role='dimension' type='nominal' datatype='string' />
  <column name='[Latitude]' role='measure' type='quantitative' datatype='real' />
  <column name='[Longitude]' role='measure' type='quantitative' datatype='real' />
  <column name='[Points]' role='measure' type='quantitative' datatype='integer' />
</datasource></datasources></workbook>`;

/**
 * The ask the binder itself wrote into the sheet name during the live failure
 * ("...with size and color both encoding Goals For..."). "color both" matches none of
 * the three narrow bind cues, so the color slot goes unbound — the exact silent skip.
 */
const COLOR_ASK_THAT_CANNOT_BIND =
  'symbol map of countries by Goals with size and color both encoding Goals';

/** The verbatim user ask from the live session; every requested encoding binds. */
const FULLY_SATISFIED_ASK =
  'Map the countries by goals scored — bigger, warmer dots for the teams that scored more, and show me each country and its goals when I hover over a dot.';

describe('binder encoding honesty — requested vs filled', () => {
  it('reports color as UNFILLED when the ask asks for it and no field binds', () => {
    const result = classifyNoLlm(
      COLOR_ASK_THAT_CANNOT_BIND,
      manifests,
      summarizeSchema(worldCupXml),
    );

    expect(result).not.toBeNull();
    // The bind itself is unchanged: still fail-closed, still no guessed color field.
    expect(result!.bindings).toEqual([
      { slot_id: 'country', field: 'Country Code' },
      { slot_id: 'sales', field: 'Goals' },
    ]);
    // ...but the binder now says so, instead of leaving the caller to assume color landed.
    expect(result!.encodings).toEqual({ filled: ['size'], unfilled: ['color'] });
  });

  it('reports every requested encoding as filled when none are missing', () => {
    const result = classifyNoLlm(FULLY_SATISFIED_ASK, manifests, summarizeSchema(worldCupXml));

    expect(result).toEqual({
      template: 'spatial-symbol-map',
      bindings: [
        { slot_id: 'country', field: 'Country Code' },
        { slot_id: 'sales', field: 'Goals' },
        { slot_id: 'color', field: 'Goals' },
        { slot_id: 'tooltip', field: 'Goals' },
      ],
      encodings: { filled: ['size', 'color', 'tooltip'], unfilled: [] },
    });
  });

  it('does not read a cue out of a FIELD NAME (no false "you asked for color")', () => {
    const result = classifyNoLlm(
      'symbol map of Country by Warm',
      manifests,
      summarizeSchema(cueNamedFieldXml),
    );

    expect(result).not.toBeNull();
    // The symbol map's required measure already drives size; neither cue-named field
    // manufactures a color/tooltip request.
    expect(result!.encodings).toEqual({ filled: ['size'], unfilled: [] });
  });

  it('the unfilled list matches what actually reached the workbook XML', async () => {
    const manifest = manifests.get('spatial-symbol-map')!;
    const snapshot = getRuntimeTemplateSnapshot('spatial-symbol-map')!;
    const geoSlots = snapshot.descriptor.slots.filter((slot) => slot.kind === 'geo');
    const runtimeSlots = snapshot.descriptor.slots.map((slot) => ({
      ...slot,
      required: slot === geoSlots[0] || slot.role.includes('size'),
    }));
    const render = async (ask: string): Promise<{ xml: string; reportsColorUnfilled: boolean }> => {
      const bound = await bindTemplate({ ask, workbookXml: worldCupXml, manifests });
      if (bound.status !== 'bound') throw new Error(`expected bound, got ${bound.status}`);
      const boundValue = (slotId: string): string | undefined => {
        const sourceSlot = manifest.slots.find((slot) => slot.slot_id === slotId);
        return sourceSlot ? bound.args.field_mapping[sourceSlot.template_field] : undefined;
      };
      const runtimeMapping: Record<string, string> = {};
      const assign = (runtimeRole: string, sourceSlotId: string): void => {
        const runtimeSlot = runtimeSlots.find((slot) => slot.role.includes(runtimeRole));
        const value = boundValue(sourceSlotId);
        if (runtimeSlot && value) runtimeMapping[runtimeSlot.template_field] = value;
      };
      if (geoSlots[0]) {
        const countryValue = boundValue('country');
        if (countryValue) runtimeMapping[geoSlots[0].template_field] = countryValue;
      }
      assign('size', 'sales');
      assign('color', 'color');
      assign('tooltip', 'tooltip');
      return {
        xml: rewriteFieldReferences(
          snapshot.xml,
          runtimeMapping,
          bound.args.template_parameters.DATASOURCE,
          undefined,
          { templateSlots: runtimeSlots },
        ),
        reportsColorUnfilled: bound.encodings?.unfilled.includes('color') === true,
      };
    };

    // Reported unfilled ⟺ the color node really is absent from the applied XML.
    const unfilled = await render(COLOR_ASK_THAT_CANNOT_BIND);
    expect(unfilled.reportsColorUnfilled).toBe(true);
    expect(unfilled.xml).not.toContain('<color ');

    expect(runtimeSlots.some((slot) => slot.role.includes('color'))).toBe(false);

    const filledSnapshot = getRuntimeTemplateSnapshot('spatial-symbol-map-latlon')!;
    const filled = await bindTemplate({
      ask: 'Build a symbol map using Latitude and Longitude with Country and City for detail. Put SUM(Points) on Size. Put SUM(Points) on Color. Put Country/Points on Tooltip.',
      workbookXml: latlonXml,
      manifests: runtimeManifests,
    });
    expect(filled.status, JSON.stringify(filled)).toBe('bound');
    if (filled.status !== 'bound') throw new Error('expected bound');
    expect(filled.encodings?.filled).toContain('color');
    const filledXml = rewriteFieldReferences(
      filledSnapshot.xml,
      filled.args.field_mapping,
      filled.args.template_parameters.DATASOURCE,
      undefined,
      { templateSlots: filledSnapshot.descriptor.slots },
    );
    expect(filledXml).toContain('<color ');
  });

  it('carries the unfilled encodings onto the bound result the tool layer reads', async () => {
    const bound = await bindTemplate({
      ask: COLOR_ASK_THAT_CANNOT_BIND,
      workbookXml: worldCupXml,
      manifests,
    });

    expect(bound.status).toBe('bound');
    if (bound.status !== 'bound') throw new Error('expected bound');
    expect(bound.encodings).toEqual({ filled: ['size'], unfilled: ['color'] });
  });

  it('never truncates the generated sheet name mid-word', async () => {
    // The live failure named the sheet "...Goals For (bigger and" — a hard 80-char slice
    // through the middle of a sentence, which is how the missing color hid in plain sight.
    const longAsk =
      'Symbol map of countries, with size and color both encoding Goals, bigger and darker for more goals';
    const bound = await bindTemplate({ ask: longAsk, workbookXml: worldCupXml, manifests });

    expect(bound.status).toBe('bound');
    if (bound.status !== 'bound') throw new Error('expected bound');
    const { title } = bound.args;
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith('…')).toBe(true);
    // Every word kept must be a whole word from the ask.
    const kept = title.slice(0, -1).trim();
    expect(longAsk.startsWith(kept)).toBe(true);
    expect(longAsk[kept.length]).toBe(' ');
  });
});
