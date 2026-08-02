import { describe, expect, it } from 'vitest';

import { autoPurpose, inferFromBookmark, synthesizeManifest } from './inferSlots.js';

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
  });
});

describe('inferFromBookmark — placement facts', () => {
  const inf = inferFromBookmark(MODERN_BOOKMARK);
  const byId = new Map(inf.slots.map((s) => [s.slot_id, s]));

  it('carries the derivation from the column-instance prefix', () => {
    expect(byId.get('sales')?.derivation).toBe('sum');
    expect(byId.get('category')?.derivation).toBe('none');
  });

  it('marks rows/cols slots required and mark-only slots optional (axis chart)', () => {
    expect(byId.get('category')?.required).toBe(true); // rows
    expect(byId.get('sales')?.required).toBe(true); // cols
    expect(byId.get('state')?.required).toBe(false); // mark only, and an axis exists
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

describe('synthesizeManifest', () => {
  const inf = inferFromBookmark(MODERN_BOOKMARK);
  const manifest = synthesizeManifest('my-template', inf);

  it('numbers template_field {{field_base_N}} in slot order', () => {
    expect(manifest.slots.map((s) => s.template_field)).toEqual(
      manifest.slots.map((_s, i) => `{{field_base_${i + 1}}}`),
    );
  });

  it('carries derivation and kind onto each SlotSpec', () => {
    const sales = manifest.slots.find((s) => s.slot_id === 'sales');
    expect(sales?.derivation).toBe('sum');
    expect(sales?.kind).toBe('quantitative');
  });

  it('uses honest unverified defaults for a freshly inferred template', () => {
    expect(manifest.readiness).toBe('YELLOW');
    expect(manifest.fast_path_eligible).toBe(false);
    expect(manifest.portability_evidence?.render_verified).toBe('none');
    expect(manifest.portability_evidence?.fixture_bind).toBe(false);
  });

  it('always declares the TITLE and DATASOURCE placeholders', () => {
    expect(manifest.placeholders).toEqual(expect.arrayContaining(['TITLE', 'DATASOURCE']));
    expect(manifest.datasource_placeholder).toBe(true);
  });

  it('marks every synthesized slot bindable', () => {
    expect(manifest.slots.every((s) => s.bindable)).toBe(true);
  });

  it('carries a suggestion hint (donor base name when no caption) on each slot', () => {
    const bySlot = new Map(manifest.slots.map((s) => [s.slot_id, s]));
    // MODERN_BOOKMARK columns have no caption, so the hint falls back to the base name.
    expect(bySlot.get('sales')?.hint).toBe('Sales');
    expect(bySlot.get('category')?.hint).toBe('Category');
  });

  it('prefers the donor caption over the base name for the hint when present', () => {
    const captioned =
      "<?xml version='1.0'?><bookmark version='10.1'>" +
      "<datasources><datasource name='ds1'>" +
      "<column name='[Sales]' caption='Total Sales' datatype='real' role='measure' type='quantitative'/>" +
      '</datasource></datasources>' +
      '<table><cols>[ds1].[sum:Sales:qk]</cols></table>' +
      '</bookmark>';
    const m = synthesizeManifest('captioned', inferFromBookmark(captioned));
    expect(m.slots.find((s) => s.slot_id === 'sales')?.hint).toBe('Total Sales');
  });
});
