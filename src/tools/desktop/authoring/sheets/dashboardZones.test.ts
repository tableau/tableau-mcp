import { describe, expect, it } from 'vitest';

import { buildDashboardXml, computeZones, type LayoutSpec, type Zone } from './dashboardZones.js';

// Characterization suite (W60 spec §5/Q2, §7 test-plan item 1): this module is a
// byte-for-byte extraction of buildAndApplyDashboard.ts's inline zone-computation
// callback body. buildAndApplyDashboard.ts now imports computeZones/buildDashboardXml
// directly, so buildAndApplyDashboard.test.ts staying green (it asserts on the
// serialized XML: `<zone`, `type-v2="text"`, kpiCount/chartCount/viewpointCount) is
// itself the no-op-refactor proof. This suite locks the pure zone math independently.

function spec(overrides: Partial<LayoutSpec> = {}): LayoutSpec {
  return { kpis: [], charts: [], layoutType: 'auto-grid', ...overrides };
}

describe('computeZones — auto-grid', () => {
  it('N=2 tiles two equal-width columns side by side, no overlap', () => {
    const zones = computeZones(undefined, spec({ charts: ['A', 'B'] }));
    expect(zones).toEqual([
      { kind: 'worksheet', h: 100000, id: 10, name: 'A', w: 50000, x: 0, y: 0 },
      { kind: 'worksheet', h: 100000, id: 11, name: 'B', w: 50000, x: 50000, y: 0 },
    ]);
  });

  it('N=3 (default cols=2) wraps to 2 rows with the known cosmetic half-width gap', () => {
    const zones = computeZones(undefined, spec({ charts: ['A', 'B', 'C'] }));
    expect(zones.map((z) => (z.kind === 'worksheet' ? z.name : ''))).toEqual(['A', 'B', 'C']);
    // Row 2 (chart C) starts at y=50000 (chartHeight = floor(100000/2)).
    expect(zones[2]).toMatchObject({ x: 0, y: 50000, w: 50000 });
  });

  it('N=4 with gridColumns=4 produces one row of four equal columns', () => {
    const zones = computeZones(undefined, spec({ charts: ['A', 'B', 'C', 'D'], gridColumns: 4 }));
    expect(zones.every((z) => z.kind === 'worksheet' && z.h === 100000)).toBe(true);
    expect(zones.map((z) => (z.kind === 'worksheet' ? z.x : -1))).toEqual([0, 25000, 50000, 75000]);
  });

  it('every zone id is unique and ascending from 10', () => {
    const zones = computeZones(undefined, spec({ charts: ['A', 'B', 'C', 'D', 'E', 'F'] }));
    const ids = zones.map((z) => z.id);
    expect(ids).toEqual([10, 11, 12, 13, 14, 15]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('zones tile [0,100000) without exceeding the canvas', () => {
    for (const zone of computeZones(undefined, spec({ charts: ['A', 'B', 'C', 'D', 'E'] }))) {
      if (zone.kind !== 'worksheet') continue;
      expect(zone.x + zone.w).toBeLessThanOrEqual(100000);
      expect(zone.y + zone.h).toBeLessThanOrEqual(100000);
    }
  });
});

describe('computeZones — rows / columns', () => {
  it('rows: N charts stack full-width top to bottom', () => {
    const zones = computeZones(undefined, spec({ charts: ['A', 'B', 'C'], layoutType: 'rows' }));
    expect(zones.every((z) => z.kind === 'worksheet' && z.w === 100000)).toBe(true);
    expect(zones.map((z) => (z.kind === 'worksheet' ? z.y : -1))).toEqual([0, 33333, 66666]);
  });

  it('columns: N charts sit side by side full-height', () => {
    const zones = computeZones(undefined, spec({ charts: ['A', 'B'], layoutType: 'columns' }));
    expect(zones.every((z) => z.kind === 'worksheet' && z.h === 100000)).toBe(true);
    expect(zones.map((z) => (z.kind === 'worksheet' ? z.x : -1))).toEqual([0, 50000]);
  });
});

describe('computeZones — title zone', () => {
  it('an 8% title text zone is prepended and pushes the chart area down', () => {
    const zones = computeZones('Q1 Sales', spec({ charts: ['A', 'B'] }));
    expect(zones[0]).toMatchObject({ kind: 'text', h: 8000, id: 10, y: 0 });
    const chartZones = zones.slice(1);
    expect(chartZones.every((z) => z.kind === 'worksheet')).toBe(true);
    // Chart area height is 100000 - 8000 = 92000, one row => each chart h=92000.
    expect(chartZones[0]).toMatchObject({ h: 92000, y: 8000 });
  });

  it('no title text zone when title is omitted', () => {
    const zones = computeZones(undefined, spec({ charts: ['A', 'B'] }));
    expect(zones.every((z) => z.kind === 'worksheet')).toBe(true);
  });
});

describe('computeZones — KPI strip (build-and-apply-dashboard only; unchanged behavior)', () => {
  it('KPI zones tile the top strip before the chart grid', () => {
    const zones = computeZones(undefined, spec({ kpis: ['K1', 'K2'], charts: ['A'] }));
    const kpiZones = zones.filter(
      (z) => z.kind === 'worksheet' && (z as Zone & { name: string }).name.startsWith('K'),
    );
    expect(kpiZones).toHaveLength(2);
    expect(kpiZones[0]).toMatchObject({ y: 0, h: 20000 });
    const chartZone = zones.find(
      (z) => z.kind === 'worksheet' && (z as Zone & { name: string }).name === 'A',
    );
    expect(chartZone).toMatchObject({ y: 20000 });
  });
});

describe('buildDashboardXml', () => {
  it('wraps zones in the fixed 1400x1000 layout-basic dashboard shape', () => {
    const zones = computeZones(undefined, spec({ charts: ['A', 'B'] }));
    const xml = buildDashboardXml('My Dashboard', zones);
    expect(xml).toContain('name="My Dashboard"');
    expect(xml).toContain('maxwidth="1400"');
    expect(xml).toContain('minheight="1000"');
    expect(xml).toContain('type-v2="layout-basic"');
    expect(xml).toContain('name="A"');
    expect(xml).toContain('name="B"');
  });

  it('escapes a dashboard name with XML metacharacters', () => {
    const xml = buildDashboardXml('A & B "Sales"', []);
    expect(xml).toContain('A &amp; B &quot;Sales&quot;');
  });

  it('an empty zone list still produces a valid layout-basic wrapper', () => {
    const xml = buildDashboardXml('Empty', []);
    expect(xml).toContain('<zone h="100000" id="9" type-v2="layout-basic"');
  });
});
