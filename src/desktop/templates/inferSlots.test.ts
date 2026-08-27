import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseInstanceRef } from './bookmarkTemplate.js';
import {
  autoPurpose,
  deriveTemplateFitFacts,
  inferBindingDescriptor,
  inferFromBookmark,
} from './inferSlots.js';

// A modern (v10.1) bookmark carrying a real donor <column> dictionary and shelf
// encodings. Every generic fact a slot exposes (kind / derivation / required / purpose)
// must come from THIS structure alone — never from a field name or chart type.
const MODERN_BOOKMARK =
  "<?xml version='1.0'?><bookmark version='10.1'>" +
  '<datasources>' +
  "<datasource name='federated.x' caption='Superstore'>" +
  "<column name='[Sales]' datatype='real' role='measure' type='quantitative'/>" +
  "<column name='[Category]' datatype='string' role='dimension' type='nominal'/>" +
  "<column name='[Order Date]' datatype='date' role='dimension' type='ordinal'/>" +
  "<column name='[State]' datatype='string' role='dimension' type='nominal' semantic-role='[State].[Name]'/>" +
  '</datasource>' +
  '</datasources>' +
  '<table>' +
  '<rows>[federated.x].[none:Category:nk]</rows>' +
  '<cols>[federated.x].[sum:Sales:qk]</cols>' +
  '<mark>[federated.x].[none:State:nk] [federated.x].[:Measure Names]</mark>' +
  '</table>' +
  '</bookmark>';

describe('parseInstanceRef — canonical Desktop derivations', () => {
  it.each([
    ['ctd', 'Customer ID'],
    ['med', 'Sales'],
    ['my', 'Order Date'],
    ['md', 'Order Date'],
    ['io', 'Customer Set'],
    ['clct', 'Spatial Calc'],
  ] as const)('classifies %s as the binding derivation', (derivation, base) => {
    expect(parseInstanceRef(`[ds].[${derivation}:${base}:qk]`)).toEqual({ base, derivation });
  });

  it('classifies generated and table-calc wrappers by their underlying binding derivation', () => {
    expect(parseInstanceRef('[ds].[fVal:sum:Sales:qk]')).toEqual({
      base: 'Sales',
      derivation: 'sum',
    });
    expect(parseInstanceRef('[ds].[pcto:cum:ctd:Customer ID:qk]')).toEqual({
      base: 'Customer ID',
      derivation: 'ctd',
    });
  });

  it('anchors an indexed table-calc instance on its role marker', () => {
    expect(parseInstanceRef('[ds].[pcto:ctd:Order ID:qk:3]')).toEqual({
      base: 'Order ID',
      derivation: 'ctd',
    });
  });
});

describe('inferFromBookmark — canonical Desktop derivations', () => {
  it('preserves ctd, med, my, and md as independently targetable slot derivations', () => {
    const raw =
      "<?xml version='1.0'?><bookmark version='10.1'>" +
      "<datasources><datasource name='ds'>" +
      "<column name='[Customer ID]' datatype='string' role='dimension' type='nominal'/>" +
      "<column name='[Sales]' datatype='real' role='measure' type='quantitative'/>" +
      "<column name='[Order Date]' datatype='date' role='dimension' type='ordinal'/>" +
      '</datasource></datasources><table>' +
      '<rows>[ds].[ctd:Customer ID:qk]</rows>' +
      '<cols>[ds].[med:Sales:qk]</cols>' +
      '<mark>[ds].[my:Order Date:ok] [ds].[md:Order Date:ok]</mark>' +
      '</table></bookmark>';

    const inference = inferFromBookmark(raw);
    expect(inference.slots.map((slot) => `${slot.sourceField}@${slot.derivation}`).sort()).toEqual([
      'Customer ID@ctd',
      'Order Date@md',
      'Order Date@my',
      'Sales@med',
    ]);

    const descriptor = inferBindingDescriptor('canonical-derivations', inference);
    expect(
      descriptor.slots.map((slot) => `${slot.template_field}@${slot.derivation}`).sort(),
    ).toEqual([
      '{{field_base_1}}@ctd',
      '{{field_base_2}}@med',
      '{{field_base_3}}@md',
      '{{field_base_3}}@my',
    ]);
  });

  it.each([
    ['magnitude__paired-bar__compare-two-series-across-categories.tbm', 'Order ID', 'qk'],
    ['flow__network__show-relationship-strength-among-nodes.tbm', 'Movie', 'ok'],
  ] as const)('preserves the authored CountD output role in %s', (file, field, instanceRole) => {
    const raw = readFileSync(
      join(process.cwd(), 'src', 'desktop', 'data', 'templates', file),
      'utf8',
    );
    const inference = inferFromBookmark(raw);
    const inferred = inference.slots.find(
      (slot) => slot.sourceField === field && slot.derivation === 'ctd',
    );
    expect(inferred?.instanceRole).toBe(instanceRole);

    const descriptor = inferBindingDescriptor(file, inference);
    expect(
      descriptor.slots.find(
        (slot) =>
          slot.template_field === inferred?.templateField &&
          slot.derivation === inferred.derivation,
      )?.instance_role,
    ).toBe(instanceRole);
  });
});

describe('inferFromBookmark — calculated-field dependency graph', () => {
  const nestedCalcBookmark = (innerName: string): string =>
    "<?xml version='1.0'?><bookmark version='10.1'>" +
    "<datasources><datasource name='ds'>" +
    "<column name='[Sales]' datatype='real' role='measure' type='quantitative'/>" +
    `<column name='[${innerName}]' datatype='real' role='measure' type='quantitative'>` +
    "<calculation class='tableau' formula='-[Sales]'/></column>" +
    "<column name='[Outer]' datatype='real' role='measure' type='quantitative'>" +
    `<calculation class='tableau' formula='[${innerName}]'/></column>` +
    '</datasource></datasources>' +
    '<table><rows>[ds].[sum:Outer:qk]</rows></table></bookmark>';

  it.each(['Neg Sales', 'Calculation_Inner'])(
    'resolves a placed calc through nested calc %s to its terminal donor field',
    (innerName) => {
      const inference = inferFromBookmark(nestedCalcBookmark(innerName));
      expect(inference.slots.map((slot) => slot.sourceField)).toEqual(['Sales']);
      expect(inference.calcs).toHaveLength(1);
      expect(inference.calcs[0]).toMatchObject({
        templateField: 'Outer',
        formulaRefs: ['Sales'],
        dependsOnSlots: ['sales'],
      });
    },
  );

  it('does not expose a structurally qualified parameter as a bindable calc leaf', () => {
    const raw =
      "<?xml version='1.0'?><bookmark version='10.1'>" +
      "<datasources><datasource name='ds'>" +
      "<column name='[Sales]' datatype='real' role='measure' type='quantitative'/>" +
      "<column name='[Outer]' datatype='real' role='measure' type='quantitative'>" +
      "<calculation class='tableau' formula='[Sales] / [Parameters].[Parameter 2]'/></column>" +
      '</datasource>' +
      "<datasource name='Parameters'><column name='[Parameter 2]' datatype='real' " +
      "param-domain-type='any' role='measure' type='quantitative' value='100.'>" +
      "<calculation class='tableau' formula='100.'/></column></datasource>" +
      '</datasources><table><rows>[ds].[sum:Outer:qk]</rows></table></bookmark>';

    const inference = inferFromBookmark(raw);
    expect(inference.slots.map((slot) => slot.sourceField)).toEqual(['Sales']);
    expect(inference.calcs[0]?.formulaRefs).toEqual(['Sales']);
  });

  it.each([
    [
      'cycle',
      "<column name='[A]' datatype='real' role='measure' type='quantitative'><calculation class='tableau' formula='[B]'/></column>" +
        "<column name='[B]' datatype='real' role='measure' type='quantitative'><calculation class='tableau' formula='[A]'/></column>",
    ],
    [
      'unresolved reference',
      "<column name='[A]' datatype='real' role='measure' type='quantitative'><calculation class='tableau' formula='[Missing]'/></column>",
    ],
  ])('fails closed for a placed calc with a %s', (_case, columns) => {
    const raw =
      "<?xml version='1.0'?><bookmark version='10.1'><datasources><datasource name='ds'>" +
      columns +
      '</datasource></datasources><table><rows>[ds].[sum:A:qk]</rows></table></bookmark>';
    expect(() => inferFromBookmark(raw)).toThrow(/calculated field dependency/i);
  });

  it('resolves the real steamgraph calc chain to Sales without exposing nested calcs', () => {
    const raw = readFileSync(
      join(
        process.cwd(),
        'src',
        'desktop',
        'data',
        'templates',
        'change-over-time__steamgraph__show-organic-stacked-flows-over-time.tbm',
      ),
      'utf8',
    );
    const inference = inferFromBookmark(raw);
    const fields = inference.slots.map((slot) => slot.sourceField);
    expect(fields).toContain('Sales');
    expect(fields).not.toContain('Calculation_3464112593755459591');
    expect(fields).not.toContain('Sales +  (copy)_3464112593755500552');
  });
});

describe('template-fit metadata — corpus invariants', () => {
  it('labels a field used directly and as a calculation input without conflating the shelves', () => {
    const raw =
      "<?xml version='1.0'?><bookmark version='10.1'>" +
      "<datasources><datasource name='ds'>" +
      "<column name='[Sales]' datatype='real' role='measure' type='quantitative'/>" +
      "<column name='[Ratio]' datatype='real' role='measure' type='quantitative'>" +
      "<calculation class='tableau' formula='[Sales]'/></column>" +
      '</datasource></datasources><table><encodings>' +
      "<tooltip column='[ds].[none:Sales:qk]'/><color column='[ds].[usr:Ratio:qk]'/>" +
      '</encodings></table></bookmark>';
    const inference = inferFromBookmark(raw);
    const descriptor = inferBindingDescriptor('both', inference);

    expect(deriveTemplateFitFacts(inference, descriptor).slot_usage).toEqual([
      {
        slot_id: 'field_base_1',
        binding_usage: 'both',
        direct_roles: ['tooltip'],
        calculation_channels: ['color'],
      },
    ]);
    expect(descriptor.slots[0]?.role).toEqual(['tooltip']);
  });

  it('derives every advertised channel and shared-field constraint from all 138 TBMs', () => {
    const templatesDir = join(process.cwd(), 'src', 'desktop', 'data', 'templates');
    const templateFiles = readdirSync(templatesDir).filter((file) => file.endsWith('.tbm'));
    expect(templateFiles).toHaveLength(138);

    for (const file of templateFiles) {
      const inference = inferFromBookmark(readFileSync(join(templatesDir, file), 'utf8'));
      const descriptor = inferBindingDescriptor(file, inference);
      const fit = deriveTemplateFitFacts(inference, descriptor);
      for (const channel of fit.visible_channels.direct) {
        expect(
          inference.slots.some((slot) => slot.directShelves?.includes(channel)),
          `${file}: direct ${channel}`,
        ).toBe(true);
      }
      for (const calculated of fit.visible_channels.calculated) {
        expect(
          descriptor.calcs.some(
            (calc) =>
              calc.role.includes(calculated.channel) &&
              calculated.dependency_slot_ids.every((slotId) =>
                calc.depends_on_slots.includes(slotId),
              ),
          ),
          `${file}: calculated ${calculated.channel}`,
        ).toBe(true);
      }

      const dependencyIds = new Set(descriptor.calcs.flatMap((calc) => calc.depends_on_slots));
      for (const usage of fit.slot_usage) {
        if (dependencyIds.has(usage.slot_id) && usage.direct_roles.length === 0) {
          expect(usage.binding_usage, `${file}:${usage.slot_id}`).toBe('calculation-input');
        }
      }

      const grouped = new Map<string, string[]>();
      for (const slot of descriptor.slots) {
        const group = grouped.get(slot.template_field) ?? [];
        group.push(slot.slot_id);
        grouped.set(slot.template_field, group);
      }
      const expectedGroups = [...grouped.values()].filter((slots) => slots.length > 1);
      expect(fit.same_field_groups, file).toEqual(expectedGroups);
    }
  });
});

describe('inferFromBookmark — kind derivation (role + datatype + semantic-role only)', () => {
  const inf = inferFromBookmark(MODERN_BOOKMARK);
  const byId = new Map(inf.slots.map((s) => [s.slot_id, s]));

  it('maps a real measure to quantitative', () => {
    expect(byId.get('sales')?.kind).toBe('quantitative');
  });

  it('maps a string dimension to categorical', () => {
    expect(byId.get('category')?.kind).toBe('categorical');
  });

  it('maps a dimension carrying a semantic-role to geo', () => {
    expect(byId.get('state')?.kind).toBe('geo');
    const descriptor = inferBindingDescriptor('geo', inf);
    expect(descriptor.slots.find((slot) => slot.kind === 'geo')?.semantic_role).toBe(
      '[State].[Name]',
    );
  });
});

describe('inferFromBookmark — placement facts', () => {
  const inf = inferFromBookmark(MODERN_BOOKMARK);
  const byId = new Map(inf.slots.map((s) => [s.slot_id, s]));

  it('carries the derivation from the column-instance prefix', () => {
    expect(byId.get('sales')?.derivation).toBe('sum');
    expect(byId.get('category')?.derivation).toBe('none');
  });

  it('requires rows/cols slots AND a disaggregated dimension on the marks card (two-prong rule)', () => {
    expect(byId.get('category')?.required).toBe(true); // rows — partitions
    expect(byId.get('sales')?.required).toBe(true); // cols — axis
    // State is a `none` (disaggregated) dimension on the marks/detail shelf: it adds a mark
    // per state, so it changes the level of detail and is load-bearing — required, even
    // though it is not on an axis. This is the LOD prong superseding the old shelf heuristic.
    expect(byId.get('state')?.required).toBe(true);
  });
});

// An encoding-only chart (pie, treemap, symbol map, choropleth, kpi-text) places every
// field on a mark-encoding shelf and NOTHING on rows/cols. Its defining encodings are the
// chart, so they must be required; only a purely incidental shelf (tooltip) stays optional.
describe('inferFromBookmark — encoding-only charts require their defining encodings', () => {
  const ENCODING_ONLY =
    "<?xml version='1.0'?><bookmark version='10.1'>" +
    "<datasources><datasource name='ds1'>" +
    "<column name='[Sales]' datatype='real' role='measure' type='quantitative'/>" +
    "<column name='[Category]' datatype='string' role='dimension' type='nominal'/>" +
    "<column name='[Notes]' datatype='string' role='dimension' type='nominal'/>" +
    '</datasource></datasources>' +
    '<table><panes><pane><encodings>' +
    "<color column='[ds1].[none:Category:nk]'/>" +
    "<size column='[ds1].[sum:Sales:qk]'/>" +
    "<tooltip column='[ds1].[none:Notes:nk]'/>" +
    '</encodings></pane></panes></table>' +
    '</bookmark>';
  const inf = inferFromBookmark(ENCODING_ONLY);
  const byId = new Map(inf.slots.map((s) => [s.slot_id, s]));

  it('makes color and size required when there is no rows/cols axis', () => {
    expect(byId.get('category')?.required).toBe(true); // color
    expect(byId.get('sales')?.required).toBe(true); // size
  });

  it('keeps a purely incidental (tooltip-only) encoding optional', () => {
    expect(byId.get('notes')?.required).toBe(false);
  });
});

describe('inferFromBookmark — pseudo-fields and donor datasource extraction', () => {
  const inf = inferFromBookmark(MODERN_BOOKMARK);

  it('skips Tableau pseudo-fields ([:Measure Names])', () => {
    expect(inf.slots.some((s) => s.sourceField.startsWith(':'))).toBe(false);
    expect(inf.slots.some((s) => s.sourceField === 'Measure Names')).toBe(false);
  });

  it('extracts the donor datasource internal name (not the caption)', () => {
    expect(inf.donorDatasourceNames).toContain('federated.x');
  });
});

describe('inferFromBookmark — unknown kinds are counted, never guessed', () => {
  it('skips a column whose datatype yields no kind and counts it', () => {
    const raw =
      "<?xml version='1.0'?><bookmark version='10.1'>" +
      "<datasources><datasource name='ds1'>" +
      "<column name='[Sales]' datatype='real' role='measure'/>" +
      "<column name='[Mystery]' datatype='' role='measure'/>" +
      '</datasource></datasources>' +
      '<table><cols>[ds1].[sum:Sales:qk]</cols><rows>[ds1].[none:Mystery:nk]</rows></table>' +
      '</bookmark>';
    const inf = inferFromBookmark(raw);
    expect(inf.slots.map((s) => s.sourceField)).toEqual(['Sales']);
    expect(inf.unknownCount).toBe(1);
  });
});

describe('inferFromBookmark — placed calc decomposes to its base leaves', () => {
  it('emits the calc base inputs as slots, not the calc itself', () => {
    const raw =
      "<?xml version='1.0'?><bookmark version='10.1'>" +
      "<datasources><datasource name='ds1'>" +
      "<column name='[Margin]' datatype='real' role='measure'>" +
      "<calculation class='tableau' formula='[Profit] / [Revenue]'/>" +
      '</column>' +
      "<column name='[Profit]' datatype='real' role='measure'/>" +
      "<column name='[Revenue]' datatype='real' role='measure'/>" +
      '</datasource></datasources>' +
      '<table><cols>[ds1].[sum:Margin:qk]</cols></table>' +
      '</bookmark>';
    const inf = inferFromBookmark(raw);
    const fields = inf.slots.map((s) => s.sourceField).sort();
    expect(fields).toEqual(['Profit', 'Revenue']);
    expect(inf.slots.some((s) => s.sourceField === 'Margin')).toBe(false);
  });

  it('binds decomposed leaves at derivation `none`, NOT the calc outer aggregation', () => {
    // A gantt-style duration calc placed as [sum:Calc:qk] over two DATE inputs. The outer
    // `sum` aggregates the DATEDIFF result — it must NOT be stamped onto the date leaves, or
    // the binder rejects `sum` on a date (Gate 4) and the whole template fails.
    const raw =
      "<?xml version='1.0'?><bookmark version='10.1'>" +
      "<datasources><datasource name='ds1'>" +
      "<column name='[Duration]' datatype='integer' role='measure'>" +
      "<calculation class='tableau' formula='DATEDIFF(&apos;day&apos;,[Order Date],[Ship Date])'/>" +
      '</column>' +
      "<column name='[Order Date]' datatype='date' role='dimension'/>" +
      "<column name='[Ship Date]' datatype='date' role='dimension'/>" +
      '</datasource></datasources>' +
      '<table><cols>[ds1].[sum:Duration:qk]</cols></table>' +
      '</bookmark>';
    const inf = inferFromBookmark(raw);
    const derivs = new Map(inf.slots.map((s) => [s.sourceField, s.derivation]));
    expect(derivs.get('Order Date')).toBe('none');
    expect(derivs.get('Ship Date')).toBe('none');
    expect([...derivs.values()]).not.toContain('sum');
  });
});

// A field can appear ONLY at a refinement site — a categorical filter/slices pill, a
// field-reference run in the sheet title, a customized mark label, or a measure positioning a
// reference line — and never on an axis or a mark encoding. Modelled on the real box-plot
// worksheet: measure on rows, one dimension on cols, a categorical filter+slices on a THIRD
// field, a title field-ref, and a reference line on the measure. Each such field must still
// surface as a slot (optional), or an agent would never see it to map it.
describe('inferFromBookmark — walks all reference sites (filter / title / label / reference-line)', () => {
  const REFINEMENT_SITES =
    "<?xml version='1.0'?><bookmark version='10.1'>" +
    "<datasources><datasource name='ds'>" +
    "<column name='[Amount]' datatype='real' role='measure' type='quantitative'/>" +
    "<column name='[Segment]' datatype='string' role='dimension' type='nominal'/>" +
    "<column name='[Company]' datatype='string' role='dimension' type='nominal'/>" +
    "<column name='[Region]' datatype='string' role='dimension' type='nominal'/>" +
    '</datasource></datasources>' +
    '<table>' +
    '<layout-options><title><formatted-text>' +
    '<run>&lt;Sheet Name&gt;</run>' +
    '<run>&lt;[ds].[attr:Company:nk]&gt;</run>' +
    '</formatted-text></title></layout-options>' +
    '<rows>[ds].[sum:Amount:qk]</rows>' +
    '<cols>[ds].[none:Segment:nk]</cols>' +
    "<filter class='categorical' column='[ds].[none:Region:nk]'>" +
    "<groupfilter function='level-members' level='[none:Region:nk]'/></filter>" +
    '<slices><column>[ds].[none:Region:nk]</column></slices>' +
    '<panes><pane>' +
    "<reference-line axis-column='[ds].[sum:Amount:qk]' value-column='[ds].[sum:Amount:qk]'/>" +
    '</pane></panes>' +
    '</table></bookmark>';
  const inf = inferFromBookmark(REFINEMENT_SITES);
  const byId = new Map(inf.slots.map((s) => [s.slot_id, s]));

  it('surfaces a filter/slices-only field as an optional slot on the filter shelf', () => {
    expect(byId.get('region')?.shelves).toContain('filter');
    expect(byId.get('region')?.required).toBe(false);
    expect(byId.get('region')?.kind).toBe('categorical');
  });

  it('surfaces a title field-reference run as an optional slot carrying its derivation', () => {
    expect(byId.get('company')?.shelves).toContain('title');
    expect(byId.get('company')?.derivation).toBe('attr');
    expect(byId.get('company')?.required).toBe(false);
  });

  it('merges a reference-line ref onto the same field placed on an axis (no duplicate slot)', () => {
    // Amount is on rows AND positions the reference line: one slot, both shelves, still required.
    expect(byId.get('amount')?.shelves).toEqual(expect.arrayContaining(['rows', 'reference-line']));
    expect(byId.get('amount')?.required).toBe(true);
    expect(inf.slots.filter((s) => s.sourceField === 'Amount')).toHaveLength(1);
  });

  it('gives refinement-only fields accurate, donor-free purposes', () => {
    expect(autoPurpose('categorical', ['filter'])).toContain('filter');
    expect(autoPurpose('categorical', ['title'])).toContain('title');
    expect(autoPurpose('quantitative', ['reference-line'])).toContain('reference line');
    // Still never names a donor field.
    for (const s of inf.slots) {
      for (const name of ['Amount', 'Segment', 'Company', 'Region']) {
        expect(s.purpose).not.toContain(name);
      }
    }
  });
});

// The LOD + display two-prong rule: a field is optional only if removing it changes NEITHER
// the level of detail NOR the display. Modelled on the real box-plot worksheet — a measure on
// rows, a categorical on cols, an AGGREGATED (attr) dimension decorating text/lod/tooltip, and
// a DISAGGREGATED (none) dimension on the detail (lod) shelf. The attr-decoration is optional
// (LOD-neutral + only on decorative encodings of an axis chart); the none-on-detail dimension
// is required (it adds a mark per member → changes the grain), even though it is not on an axis.
describe('inferFromBookmark — LOD + display two-prong optionality', () => {
  const TWO_PRONG =
    "<?xml version='1.0'?><bookmark version='10.1'>" +
    "<datasources><datasource name='ds'>" +
    "<column name='[Amount]' datatype='real' role='measure' type='quantitative'/>" +
    "<column name='[Segment]' datatype='string' role='dimension' type='nominal'/>" +
    "<column name='[Company]' datatype='string' role='dimension' type='nominal'/>" +
    "<column name='[Detail]' datatype='string' role='dimension' type='nominal'/>" +
    '</datasource></datasources>' +
    '<table>' +
    '<rows>[ds].[sum:Amount:qk]</rows>' +
    '<cols>[ds].[none:Segment:nk]</cols>' +
    '<panes><pane><encodings>' +
    "<text column='[ds].[attr:Company:nk]'/>" +
    "<lod column='[ds].[attr:Company:nk]'/>" +
    "<lod column='[ds].[none:Detail:nk]'/>" +
    "<tooltip column='[ds].[attr:Company:nk]'/>" +
    '</encodings></pane></panes>' +
    '</table></bookmark>';
  const inf = inferFromBookmark(TWO_PRONG);
  const byId = new Map(inf.slots.map((s) => [s.slot_id, s]));

  it('requires the axis measure and the axis dimension', () => {
    expect(byId.get('amount')?.required).toBe(true); // rows
    expect(byId.get('segment')?.required).toBe(true); // cols
  });

  it('makes an AGGREGATED (attr) dimension on decorative encodings of an axis chart optional', () => {
    // attr is LOD-neutral and text/lod/tooltip do not define an axis chart → both prongs clear.
    expect(byId.get('company')?.derivation).toBe('attr');
    expect(byId.get('company')?.required).toBe(false);
  });

  it('requires a DISAGGREGATED (none) dimension on the detail shelf (LOD prong)', () => {
    // none on lod/detail adds a mark per member → changes the grain, so it is load-bearing.
    expect(byId.get('detail')?.derivation).toBe('none');
    expect(byId.get('detail')?.required).toBe(true);
  });
});

// Each slot carries a single communicative role — what it DOES in the chart — derived from
// kind + derivation + placement, distinct from the structural shelf list and the prose purpose.
describe('inferFromBookmark — communicative role', () => {
  const ALL_ROLES =
    "<?xml version='1.0'?><bookmark version='10.1'>" +
    "<datasources><datasource name='ds'>" +
    "<column name='[Amount]' datatype='real' role='measure' type='quantitative'/>" +
    "<column name='[Segment]' datatype='string' role='dimension' type='nominal'/>" +
    "<column name='[Detail]' datatype='string' role='dimension' type='nominal'/>" +
    "<column name='[Label]' datatype='string' role='dimension' type='nominal'/>" +
    "<column name='[Region]' datatype='string' role='dimension' type='nominal'/>" +
    '</datasource></datasources>' +
    '<table>' +
    '<rows>[ds].[sum:Amount:qk]</rows>' +
    '<cols>[ds].[none:Segment:nk]</cols>' +
    "<filter class='categorical' column='[ds].[none:Region:nk]'>" +
    "<groupfilter function='level-members' level='[none:Region:nk]'/></filter>" +
    '<panes><pane><encodings>' +
    "<lod column='[ds].[none:Detail:nk]'/>" +
    "<tooltip column='[ds].[attr:Label:nk]'/>" +
    '</encodings></pane></panes>' +
    '</table></bookmark>';
  const inf = inferFromBookmark(ALL_ROLES);
  const byId = new Map(inf.slots.map((s) => [s.slot_id, s]));

  it('labels a measure on an axis as measure-value', () => {
    expect(byId.get('amount')?.role).toBe('measure-value');
  });

  it('labels a dimension on an axis as axis-partition', () => {
    expect(byId.get('segment')?.role).toBe('axis-partition');
  });

  it('labels a disaggregated dimension on a mark encoding as distribution-breakout', () => {
    expect(byId.get('detail')?.role).toBe('distribution-breakout');
  });

  it('labels an aggregated (attr) dimension on a decorative encoding as decoration', () => {
    expect(byId.get('label')?.role).toBe('decoration');
  });

  it('labels a filter/slices pill as filter-scope', () => {
    expect(byId.get('region')?.role).toBe('filter-scope');
  });

  it('carries the communicative role onto each synthesized SlotSpec', () => {
    const m = inferBindingDescriptor('all-roles', inf);
    const byField = new Map(m.slots.map((s) => [s.template_field, s]));
    expect(byField.get('{{field_base_1}}')?.communicative_role).toBe('measure-value');
    expect(byField.get('{{field_base_5}}')?.communicative_role).toBe('filter-scope');
  });
});

// A table calc lives on a <column-instance> as one or more <table-calc> children; the CI name
// chains the wrapper prefixes onto the base aggregation (`cum:sum:Sales:qk`). Inference must
// (a) still resolve the wrapped measure to its base (not drop it as kind: unknown), (b) attach
// a table-calc fact to that measure, and (c) for ABSOLUTE addressing, upgrade the addressing
// dimension slots to required with a tablecalc-* role — RELATIVE addressing names no dimension
// and must leave the dims alone. Modelled on the confirmed XML in the table-calcs knowledge doc.
describe('inferFromBookmark — table-calc semantics as a first-class slot fact', () => {
  // Running Total, Compute Using = Table (across) → ordering-type="Rows", positional. Names no
  // dimension, so the date axis keeps its ordinary axis-partition role.
  const RELATIVE =
    "<?xml version='1.0'?><bookmark version='10.1'>" +
    "<datasources><datasource name='ds'>" +
    "<column name='[Sales]' datatype='real' role='measure' type='quantitative'/>" +
    "<column name='[Order Date]' datatype='date' role='dimension' type='ordinal'/>" +
    "<column-instance column='[Sales]' derivation='Sum' name='[cum:sum:Sales:qk]' pivot='key' type='quantitative'>" +
    "<table-calc aggregation='Sum' ordering-type='Rows' type='CumTotal'/>" +
    '</column-instance>' +
    '</datasource></datasources>' +
    '<table>' +
    '<rows>[ds].[cum:sum:Sales:qk]</rows>' +
    '<cols>[ds].[yr:Order Date:ok]</cols>' +
    '</table></bookmark>';
  const rel = inferFromBookmark(RELATIVE);
  const relById = new Map(rel.slots.map((s) => [s.slot_id, s]));

  it('resolves a wrapped measure to its base slot (not dropped as unknown)', () => {
    expect(relById.get('sales')?.kind).toBe('quantitative');
    expect(relById.get('sales')?.derivation).toBe('sum');
    expect(rel.unknownCount).toBe(0);
  });

  it('attaches a relative-addressing table-calc fact to the measure', () => {
    const tc = relById.get('sales')?.tableCalc;
    expect(tc?.types).toContain('CumTotal');
    expect(tc?.addressing).toBe('relative');
    expect(tc?.along).toEqual([]);
    expect(tc?.reset_on).toEqual([]);
  });

  it('leaves the addressing dimension alone for relative addressing', () => {
    // Positional Compute Using names no dimension → the date stays an ordinary axis partition.
    expect(relById.get('order_date')?.role).toBe('axis-partition');
  });

  // Year over Year Growth Rate: PctDiff pinned to Order Date via ordering-type="Field" +
  // ordering-field + level-address → ABSOLUTE. The date it runs ALONG is load-bearing.
  const ABSOLUTE_YOY =
    "<?xml version='1.0'?><bookmark version='10.1'>" +
    "<datasources><datasource name='ds'>" +
    "<column name='[Sales]' datatype='real' role='measure' type='quantitative'/>" +
    "<column name='[Order Date]' datatype='date' role='dimension' type='ordinal'/>" +
    "<column-instance column='[Sales]' derivation='Sum' name='[pcdf:sum:Sales:qk]' pivot='key' type='quantitative'>" +
    "<table-calc diff-options='Relative' level-address='[ds].[yr:Order Date:ok]' " +
    "ordering-field='[ds].[Order Date]' ordering-type='Field' type='PctDiff'>" +
    '<address><value>-1</value></address>' +
    '</table-calc>' +
    '</column-instance>' +
    '</datasource></datasources>' +
    '<table>' +
    '<rows>[ds].[pcdf:sum:Sales:qk]</rows>' +
    '<cols>[ds].[yr:Order Date:ok]</cols>' +
    '</table></bookmark>';
  const yoy = inferFromBookmark(ABSOLUTE_YOY);
  const yoyById = new Map(yoy.slots.map((s) => [s.slot_id, s]));

  it('marks an absolute-addressed measure with the addressing mode and along dimension', () => {
    const tc = yoyById.get('sales')?.tableCalc;
    expect(tc?.types).toContain('PctDiff');
    expect(tc?.addressing).toBe('absolute');
    expect(tc?.along).toContain('Order Date');
  });

  it('upgrades the along dimension to required with a tablecalc-addressing role', () => {
    expect(yoyById.get('order_date')?.role).toBe('tablecalc-addressing');
    expect(yoyById.get('order_date')?.required).toBe(true);
  });

  // YTD Total: CumTotal with level-break on Order Date → the date RESETS accumulation.
  const ABSOLUTE_YTD =
    "<?xml version='1.0'?><bookmark version='10.1'>" +
    "<datasources><datasource name='ds'>" +
    "<column name='[Sales]' datatype='real' role='measure' type='quantitative'/>" +
    "<column name='[Order Date]' datatype='date' role='dimension' type='ordinal'/>" +
    "<column-instance column='[Sales]' derivation='Sum' name='[cum:sum:Sales:qk]' pivot='key' type='quantitative'>" +
    "<table-calc aggregation='Sum' level-break='[ds].[qr:Order Date:ok]' " +
    "ordering-field='[ds].[Order Date]' ordering-type='Field' type='CumTotal'/>" +
    '</column-instance>' +
    '</datasource></datasources>' +
    '<table>' +
    '<rows>[ds].[cum:sum:Sales:qk]</rows>' +
    '<cols>[ds].[qr:Order Date:ok]</cols>' +
    '</table></bookmark>';
  const ytd = inferFromBookmark(ABSOLUTE_YTD);
  const ytdById = new Map(ytd.slots.map((s) => [s.slot_id, s]));

  it('upgrades a level-break (reset) dimension to a tablecalc-partition role', () => {
    expect(ytdById.get('sales')?.tableCalc?.reset_on).toContain('Order Date');
    expect(ytdById.get('order_date')?.role).toBe('tablecalc-partition');
    expect(ytdById.get('order_date')?.required).toBe(true);
  });

  it('carries the table-calc fact onto the synthesized SlotSpec', () => {
    const m = inferBindingDescriptor('yoy', yoy);
    const sales = m.slots.find((s) => s.table_calc);
    expect(sales?.table_calc?.addressing).toBe('absolute');
    expect(sales?.table_calc?.along).toContain('Order Date');
  });
});

describe('the zero-donor-name-leakage invariant', () => {
  it('never names a concrete donor field in any inferred purpose', () => {
    const inf = inferFromBookmark(MODERN_BOOKMARK);
    const donorNames = ['Sales', 'Category', 'Order Date', 'State'];
    for (const s of inf.slots) {
      for (const name of donorNames) {
        expect(s.purpose).not.toContain(name);
      }
    }
  });

  it('autoPurpose phrasing is generic and independent of any field name', () => {
    // Same kind + shelf → same phrasing regardless of which donor field it was.
    expect(autoPurpose('quantitative', ['cols'])).toBe(autoPurpose('quantitative', ['rows']));
    expect(autoPurpose('geo', ['rows'])).toContain('map');
    expect(autoPurpose('temporal', ['cols'])).toContain('temporal');
  });
});

describe('inferBindingDescriptor', () => {
  const inf = inferFromBookmark(MODERN_BOOKMARK);
  const manifest = inferBindingDescriptor('my-template', inf);

  it('numbers template_field {{field_base_N}} in slot order', () => {
    expect(manifest.slots.map((s) => s.template_field)).toEqual(
      manifest.slots.map((_s, i) => `{{field_base_${i + 1}}}`),
    );
  });

  it('carries derivation and kind onto each SlotSpec', () => {
    const sales = manifest.slots.find((s) => s.derivation === 'sum');
    expect(sales?.derivation).toBe('sum');
    expect(sales?.kind).toBe('quantitative');
  });

  it('marks every synthesized slot bindable', () => {
    expect(manifest.slots.every((s) => s.bindable)).toBe(true);
  });
});

describe('structural binding descriptor boundary', () => {
  it('exports only neutral structural binding data', async () => {
    const module = await import('./inferSlots.js');
    expect(module).toHaveProperty('inferBindingDescriptor');
    expect(module).not.toHaveProperty('synthesizeManifest');

    const describeBinding = module.inferBindingDescriptor as unknown as (
      name: string,
      inference: ReturnType<typeof inferFromBookmark>,
    ) => Record<string, unknown>;
    const descriptor = describeBinding('my-template', inferFromBookmark(MODERN_BOOKMARK)) as {
      slots: Array<Record<string, unknown>>;
      calcs: Array<Record<string, unknown>>;
    } & Record<string, unknown>;

    expect(Object.keys(descriptor)).toEqual(['template', 'slots', 'calcs']);
    expect(descriptor.slots.map((slot) => slot.slot_id)).toEqual([
      'field_base_1',
      'field_base_2',
      'field_base_3',
    ]);
    expect(descriptor.slots.every((slot) => !('hint' in slot))).toBe(true);
  });
});
