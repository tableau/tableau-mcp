import { describe, expect, it } from 'vitest';

import { buildDashboardXml, computeZones, type LayoutSpec, type Zone } from './dashboardZones.js';

// Literal zone expectations keep direct and batched dashboard composition on the same math.

function spec(overrides: Partial<LayoutSpec> = {}): LayoutSpec {
  return { kpis: [], charts: [], layoutType: 'auto-grid', ...overrides };
}

function executiveSpec(overrides: Partial<LayoutSpec> = {}): LayoutSpec {
  return {
    kpis: [],
    charts: [],
    layoutType: 'executive-summary',
    ...overrides,
  };
}

describe('computeZones — auto-grid', () => {
  it('N=2 tiles two equal-width columns side by side, no overlap', () => {
    const zones = computeZones(undefined, spec({ charts: ['A', 'B'] }));
    expect(zones).toEqual([
      { kind: 'worksheet', h: 100000, id: 10, name: 'A', w: 50000, x: 0, y: 0 },
      { kind: 'worksheet', h: 100000, id: 11, name: 'B', w: 50000, x: 50000, y: 0 },
    ]);
  });

  it('N=3 (default cols=2) expands the final chart across the incomplete row', () => {
    const zones = computeZones(undefined, spec({ charts: ['A', 'B', 'C'] }));
    expect(zones.map((z) => (z.kind === 'worksheet' ? z.name : ''))).toEqual(['A', 'B', 'C']);
    // Row 2 (chart C) starts at y=50000 (chartHeight = floor(100000/2)).
    expect(zones[2]).toMatchObject({ x: 0, y: 50000, w: 100000 });
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
  it('retains the 8% title band for non-executive layouts', () => {
    const zones = computeZones('Q1 Sales', spec({ charts: ['A', 'B'] }));
    expect(zones[0]).toMatchObject({ kind: 'text', h: 8000, id: 10, y: 0 });
    const chartZones = zones.slice(1);
    expect(chartZones.every((z) => z.kind === 'worksheet')).toBe(true);
    expect(chartZones[0]).toMatchObject({ h: 92000, y: 8000 });
  });

  it('no title text zone when title is omitted', () => {
    const zones = computeZones(undefined, spec({ charts: ['A', 'B'] }));
    expect(zones.every((z) => z.kind === 'worksheet')).toBe(true);
  });
});

describe('computeZones — executive summary', () => {
  it('puts ordered KPIs in a 12% strip below the title and gives one chart the rest', () => {
    const zones = computeZones(
      'Executive Overview',
      executiveSpec({ kpis: ['Sales', 'Profit', 'Orders'], charts: ['Trend'] }),
    );

    expect(zones).toEqual([
      {
        kind: 'text',
        h: 6000,
        id: 10,
        w: 100000,
        x: 0,
        y: 0,
        text: 'Executive Overview',
        bold: 'true',
        fontAlignment: '1',
        fontSize: '16',
      },
      { kind: 'worksheet', h: 12000, id: 11, name: 'Sales', w: 33333, x: 0, y: 6000 },
      {
        kind: 'worksheet',
        h: 12000,
        id: 12,
        name: 'Profit',
        w: 33333,
        x: 33333,
        y: 6000,
      },
      {
        kind: 'worksheet',
        h: 12000,
        id: 13,
        name: 'Orders',
        w: 33334,
        x: 66666,
        y: 6000,
      },
      { kind: 'worksheet', h: 82000, id: 14, name: 'Trend', w: 100000, x: 0, y: 18000 },
    ]);
  });

  it('gives two charts a 60/40 primary-secondary split in input order', () => {
    const zones = computeZones(
      undefined,
      executiveSpec({ kpis: ['KPI'], charts: ['Primary', 'Secondary'] }),
    );

    expect(zones).toEqual([
      { kind: 'worksheet', h: 12000, id: 10, name: 'KPI', w: 100000, x: 0, y: 0 },
      {
        kind: 'worksheet',
        h: 88000,
        id: 11,
        name: 'Primary',
        w: 60000,
        x: 0,
        y: 12000,
      },
      {
        kind: 'worksheet',
        h: 88000,
        id: 12,
        name: 'Secondary',
        w: 40000,
        x: 60000,
        y: 12000,
      },
    ]);
  });

  it('keeps the executive KPI strip at 12% when a legacy height override is present', () => {
    const zones = computeZones(
      undefined,
      executiveSpec({ kpis: ['KPI'], charts: ['Primary'], kpiStripHeight: 50 }),
    );

    expect(zones).toEqual([
      { kind: 'worksheet', h: 12000, id: 10, name: 'KPI', w: 100000, x: 0, y: 0 },
      {
        kind: 'worksheet',
        h: 88000,
        id: 11,
        name: 'Primary',
        w: 100000,
        x: 0,
        y: 12000,
      },
    ]);
  });

  it('puts one primary chart above two equal supporting charts', () => {
    const zones = computeZones(
      undefined,
      executiveSpec({ charts: ['Primary', 'Left support', 'Right support'] }),
    );

    expect(zones).toEqual([
      {
        kind: 'worksheet',
        h: 60000,
        id: 10,
        name: 'Primary',
        w: 100000,
        x: 0,
        y: 0,
      },
      {
        kind: 'worksheet',
        h: 40000,
        id: 11,
        name: 'Left support',
        w: 50000,
        x: 0,
        y: 60000,
      },
      {
        kind: 'worksheet',
        h: 40000,
        id: 12,
        name: 'Right support',
        w: 50000,
        x: 50000,
        y: 60000,
      },
    ]);
  });

  it('tiles four charts as an exact two-by-two grid', () => {
    const zones = computeZones(undefined, executiveSpec({ charts: ['A', 'B', 'C', 'D'] }));

    expect(zones).toEqual([
      { kind: 'worksheet', h: 50000, id: 10, name: 'A', w: 50000, x: 0, y: 0 },
      { kind: 'worksheet', h: 50000, id: 11, name: 'B', w: 50000, x: 50000, y: 0 },
      { kind: 'worksheet', h: 50000, id: 12, name: 'C', w: 50000, x: 0, y: 50000 },
      { kind: 'worksheet', h: 50000, id: 13, name: 'D', w: 50000, x: 50000, y: 50000 },
    ]);
  });

  it('tiles more than four charts across deterministic three-column rows without gaps', () => {
    const zones = computeZones(undefined, executiveSpec({ charts: ['A', 'B', 'C', 'D', 'E'] }));

    expect(zones).toEqual([
      { kind: 'worksheet', h: 50000, id: 10, name: 'A', w: 33333, x: 0, y: 0 },
      { kind: 'worksheet', h: 50000, id: 11, name: 'B', w: 33333, x: 33333, y: 0 },
      { kind: 'worksheet', h: 50000, id: 12, name: 'C', w: 33334, x: 66666, y: 0 },
      { kind: 'worksheet', h: 50000, id: 13, name: 'D', w: 50000, x: 0, y: 50000 },
      { kind: 'worksheet', h: 50000, id: 14, name: 'E', w: 50000, x: 50000, y: 50000 },
    ]);
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
  it('writes title text directly under the text zone in Desktop readback shape', () => {
    const zones = computeZones('Q1 Sales', spec({ charts: ['A'] }));
    const xml = buildDashboardXml('My Dashboard', zones);

    expect(xml).toContain(
      '<zone h="8000" id="10" type-v2="text" w="100000" x="0" y="0">\n          <formatted-text>',
    );
    expect(xml).not.toContain('<zone-text>');
  });

  it('leaves dashboard title font and color to the workbook style', () => {
    const zones = computeZones('Q1 Sales', spec({ charts: ['A'] }));
    const xml = buildDashboardXml('My Dashboard', zones);

    expect(xml).not.toContain('fontcolor="#1f77b4"');
    expect(xml).not.toContain('fontname="Tableau Semibold"');
    expect(xml).toContain('bold="true"');
    expect(xml).toContain('fontsize="16"');
  });

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
