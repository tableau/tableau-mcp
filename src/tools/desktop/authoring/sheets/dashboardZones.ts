// Shared zone computation for direct and batched dashboard composition.

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
  charts: z.array(z.string()).describe('Viz worksheet names'),
  layoutType: z.enum(['auto-grid', 'rows', 'columns', 'custom']).optional().default('auto-grid'),
  gridColumns: z.number().optional().describe('Auto-grid column count'),
  kpiStripHeight: z.number().optional().describe('KPI strip height percent'),
  customZones: z.array(customZoneSchema).optional(),
});

type DirectLayoutSpec = z.infer<typeof layoutSpecSchema>;
export type LayoutSpec = Omit<DirectLayoutSpec, 'layoutType'> & {
  layoutType: DirectLayoutSpec['layoutType'] | 'executive-summary';
};

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
      fontColor?: string;
      fontName?: string;
      fontSize: string;
    }
  | { kind: 'worksheet'; h: number; id: number; name: string; w: number; x: number; y: number };

export function buildZoneXml(zone: Zone): string {
  if (zone.kind === 'text') {
    const fontColor = zone.fontColor ? ` fontcolor="${zone.fontColor}"` : '';
    const fontName = zone.fontName ? ` fontname="${zone.fontName}"` : '';
    return `<zone h="${zone.h}" id="${zone.id}" type-v2="text" w="${zone.w}" x="${zone.x}" y="${zone.y}">
          <formatted-text>
            <run bold="${zone.bold}" fontalignment="${zone.fontAlignment}"${fontColor}${fontName} fontsize="${zone.fontSize}">${zone.text}</run>
          </formatted-text>
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

/** Compute the shared zone tree used by direct and batched dashboard composition. */
export function computeZones(titleText: string | undefined, layoutSpec: LayoutSpec): Zone[] {
  const zones: Zone[] = [];
  let nextId = 10;
  let currentY = 0;
  const isExecutiveSummary = layoutSpec.layoutType === 'executive-summary';
  const titleHeight = isExecutiveSummary ? 6000 : 8000;

  if (titleText) {
    zones.push({
      kind: 'text',
      h: titleHeight,
      id: nextId++,
      w: 100000,
      x: 0,
      y: currentY,
      text: escapeXml(titleText),
      bold: 'true',
      fontAlignment: '1',
      fontSize: '16',
    });
    currentY += titleHeight;
  }

  const kpiStripHeightPct = isExecutiveSummary ? 12 : (layoutSpec.kpiStripHeight ?? 20);
  const kpiStripHeight = Math.floor(100000 * (kpiStripHeightPct / 100));
  const chartYOffset = layoutSpec.kpis.length > 0 ? currentY + kpiStripHeight : currentY;
  const chartAreaHeight = 100000 - chartYOffset;

  if (layoutSpec.kpis.length > 0) {
    const kpiWidth = Math.floor(100000 / layoutSpec.kpis.length);
    for (let i = 0; i < layoutSpec.kpis.length; i++) {
      const executiveWidth = partitionSpan(100000, layoutSpec.kpis.length, i);
      zones.push({
        kind: 'worksheet',
        h: kpiStripHeight,
        id: nextId++,
        name: layoutSpec.kpis[i],
        w: isExecutiveSummary ? executiveWidth.size : kpiWidth,
        x: isExecutiveSummary ? executiveWidth.offset : i * kpiWidth,
        y: currentY,
      });
    }
  }

  if (layoutSpec.charts.length > 0) {
    const { layoutType, charts, gridColumns, customZones } = layoutSpec;

    if (layoutType === 'executive-summary') {
      appendExecutiveChartZones({
        zones,
        charts,
        chartYOffset,
        chartAreaHeight,
        nextId,
      });
    } else if (layoutType === 'custom' && customZones) {
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
        const row = Math.floor(i / cols);
        const isLastRow = row === rows - 1;
        const lastRowCount = charts.length - row * cols;
        const rowColumns = isLastRow ? Math.min(cols, lastRowCount) : cols;
        const rowChartWidth = isLastRow ? Math.floor(100000 / rowColumns) : chartWidth;
        zones.push({
          kind: 'worksheet',
          h: chartHeight,
          id: nextId++,
          name: charts[i],
          w: rowChartWidth,
          x: (i % cols) * rowChartWidth,
          y: chartYOffset + row * chartHeight,
        });
      }
    }
  }

  return zones;
}

function appendExecutiveChartZones({
  zones,
  charts,
  chartYOffset,
  chartAreaHeight,
  nextId,
}: {
  zones: Zone[];
  charts: string[];
  chartYOffset: number;
  chartAreaHeight: number;
  nextId: number;
}): void {
  if (charts.length === 1) {
    zones.push({
      kind: 'worksheet',
      h: chartAreaHeight,
      id: nextId++,
      name: charts[0],
      w: 100000,
      x: 0,
      y: chartYOffset,
    });
    return;
  }

  if (charts.length === 2) {
    zones.push(
      {
        kind: 'worksheet',
        h: chartAreaHeight,
        id: nextId++,
        name: charts[0],
        w: 60000,
        x: 0,
        y: chartYOffset,
      },
      {
        kind: 'worksheet',
        h: chartAreaHeight,
        id: nextId++,
        name: charts[1],
        w: 40000,
        x: 60000,
        y: chartYOffset,
      },
    );
    return;
  }

  if (charts.length === 3) {
    const primaryHeight = Math.floor(chartAreaHeight * 0.6);
    const supportingHeight = chartAreaHeight - primaryHeight;
    zones.push(
      {
        kind: 'worksheet',
        h: primaryHeight,
        id: nextId++,
        name: charts[0],
        w: 100000,
        x: 0,
        y: chartYOffset,
      },
      {
        kind: 'worksheet',
        h: supportingHeight,
        id: nextId++,
        name: charts[1],
        w: 50000,
        x: 0,
        y: chartYOffset + primaryHeight,
      },
      {
        kind: 'worksheet',
        h: supportingHeight,
        id: nextId++,
        name: charts[2],
        w: 50000,
        x: 50000,
        y: chartYOffset + primaryHeight,
      },
    );
    return;
  }

  const columns = charts.length === 4 ? 2 : 3;
  const rows = Math.ceil(charts.length / columns);
  for (let index = 0; index < charts.length; index++) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const rowSpan = partitionSpan(chartAreaHeight, rows, row);
    const chartsInRow = Math.min(columns, charts.length - row * columns);
    const columnSpan = partitionSpan(100000, chartsInRow, column);
    zones.push({
      kind: 'worksheet',
      h: rowSpan.size,
      id: nextId++,
      name: charts[index],
      w: columnSpan.size,
      x: columnSpan.offset,
      y: chartYOffset + rowSpan.offset,
    });
  }
}

function partitionSpan(
  total: number,
  count: number,
  index: number,
): { offset: number; size: number } {
  const baseSize = Math.floor(total / count);
  const offset = baseSize * index;
  return {
    offset,
    size: index === count - 1 ? total - offset : baseSize,
  };
}
