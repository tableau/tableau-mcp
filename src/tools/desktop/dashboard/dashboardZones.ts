// Pure zone-computation module extracted byte-for-byte from
// buildAndApplyDashboard.ts:58-118,169-273 (W60 single-pass dashboard-auto-apply spec, §5/Q2)
// so both build-and-apply-dashboard (KPI strip + custom zones, unchanged behavior) and the new
// dashboard-auto-apply tool (v1: auto-grid/rows/columns only, no KPIs/custom) share ONE zone
// builder. No fs, no MCP — pure over its inputs so it is characterization-testable.

import { z } from 'zod';

export const customZoneSchema = z.object({
  worksheetName: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export const layoutSpecSchema = z.object({
  kpis: z.array(z.string()).describe('KPI worksheet names'),
  charts: z.array(z.string()).describe('Chart worksheet names'),
  layoutType: z.enum(['auto-grid', 'rows', 'columns', 'custom']).optional().default('auto-grid'),
  gridColumns: z.number().optional().describe('Auto-grid column count'),
  kpiStripHeight: z.number().optional().describe('KPI strip height percent'),
  customZones: z.array(customZoneSchema).optional(),
});

export type LayoutSpec = z.infer<typeof layoutSpecSchema>;

const ZONE_STYLE = `<zone-style>
            <format attr="border-color" value="#000000"/>
            <format attr="border-style" value="none"/>
            <format attr="border-width" value="0"/>
            <format attr="margin" value="4"/>
          </zone-style>`;

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export type Zone =
  | {
      kind: 'text';
      h: number;
      id: number;
      w: number;
      x: number;
      y: number;
      text: string;
      bold: string;
      fontAlignment: string;
      fontColor: string;
      fontName: string;
      fontSize: string;
    }
  | { kind: 'worksheet'; h: number; id: number; name: string; w: number; x: number; y: number };

export function buildZoneXml(zone: Zone): string {
  if (zone.kind === 'text') {
    return `<zone h="${zone.h}" id="${zone.id}" type-v2="text" w="${zone.w}" x="${zone.x}" y="${zone.y}">
          <zone-text>
            <formatted-text>
              <run bold="${zone.bold}" fontalignment="${zone.fontAlignment}" fontcolor="${zone.fontColor}" fontname="${zone.fontName}" fontsize="${zone.fontSize}">${zone.text}</run>
            </formatted-text>
          </zone-text>
          ${ZONE_STYLE}
        </zone>`;
  }
  return `<zone h="${zone.h}" id="${zone.id}" name="${escapeXml(zone.name)}" w="${zone.w}" x="${zone.x}" y="${zone.y}">
          ${ZONE_STYLE}
        </zone>`;
}

export function buildDashboardXml(dashboardName: string, zones: Zone[]): string {
  const zonesXml = zones.map(buildZoneXml).join('\n        ');
  return `<dashboard enable-sort-zone-taborder="true" name="${escapeXml(dashboardName)}">
  <style/>
  <size maxheight="1000" maxwidth="1400" minheight="1000" minwidth="1400" sizing-mode="fixed"/>
  <zones>
    <zone h="100000" id="9" type-v2="layout-basic" w="100000" x="0" y="0">
        ${zonesXml}
    </zone>
  </zones>
</dashboard>`;
}

/**
 * Compute the zone tree for a dashboard from an optional title and a layout spec —
 * lifted verbatim (same math, same zone-id sequencing) from
 * buildAndApplyDashboard.ts's inline callback body so both tools produce
 * byte-identical XML via {@link buildDashboardXml}.
 */
export function computeZones(titleText: string | undefined, layoutSpec: LayoutSpec): Zone[] {
  const zones: Zone[] = [];
  let nextId = 10;
  let currentY = 0;

  if (titleText) {
    zones.push({
      kind: 'text',
      h: 8000,
      id: nextId++,
      w: 100000,
      x: 0,
      y: currentY,
      text: escapeXml(titleText),
      bold: 'true',
      fontAlignment: '1',
      fontColor: '#1f77b4',
      fontName: 'Tableau Semibold',
      fontSize: '16',
    });
    currentY += 8000;
  }

  const kpiStripHeightPct = layoutSpec.kpiStripHeight ?? 20;
  const kpiStripHeight = Math.floor(100000 * (kpiStripHeightPct / 100));
  const chartYOffset = layoutSpec.kpis.length > 0 ? currentY + kpiStripHeight : currentY;
  const chartAreaHeight = 100000 - chartYOffset;

  if (layoutSpec.kpis.length > 0) {
    const kpiWidth = Math.floor(100000 / layoutSpec.kpis.length);
    for (let i = 0; i < layoutSpec.kpis.length; i++) {
      zones.push({
        kind: 'worksheet',
        h: kpiStripHeight,
        id: nextId++,
        name: layoutSpec.kpis[i],
        w: kpiWidth,
        x: i * kpiWidth,
        y: currentY,
      });
    }
  }

  if (layoutSpec.charts.length > 0) {
    const { layoutType, charts, gridColumns, customZones } = layoutSpec;

    if (layoutType === 'custom' && customZones) {
      for (const cz of customZones) {
        if (charts.includes(cz.worksheetName)) {
          zones.push({
            kind: 'worksheet',
            h: cz.height,
            id: nextId++,
            name: cz.worksheetName,
            w: cz.width,
            x: cz.x,
            y: cz.y,
          });
        }
      }
    } else if (layoutType === 'rows') {
      const chartHeight = Math.floor(chartAreaHeight / charts.length);
      for (let i = 0; i < charts.length; i++) {
        zones.push({
          kind: 'worksheet',
          h: chartHeight,
          id: nextId++,
          name: charts[i],
          w: 100000,
          x: 0,
          y: chartYOffset + i * chartHeight,
        });
      }
    } else if (layoutType === 'columns') {
      const chartWidth = Math.floor(100000 / charts.length);
      for (let i = 0; i < charts.length; i++) {
        zones.push({
          kind: 'worksheet',
          h: chartAreaHeight,
          id: nextId++,
          name: charts[i],
          w: chartWidth,
          x: i * chartWidth,
          y: chartYOffset,
        });
      }
    } else {
      // auto-grid (default)
      const cols = gridColumns ?? Math.min(2, charts.length);
      const rows = Math.ceil(charts.length / cols);
      const chartWidth = Math.floor(100000 / cols);
      const chartHeight = Math.floor(chartAreaHeight / rows);
      for (let i = 0; i < charts.length; i++) {
        zones.push({
          kind: 'worksheet',
          h: chartHeight,
          id: nextId++,
          name: charts[i],
          w: chartWidth,
          x: (i % cols) * chartWidth,
          y: chartYOffset + Math.floor(i / cols) * chartHeight,
        });
      }
    }
  }

  return zones;
}
