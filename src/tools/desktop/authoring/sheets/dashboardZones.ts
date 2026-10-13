// Shared zone computation for direct and batched dashboard composition.

import { z } from 'zod';

import { ArgsValidationError } from '../../../../errors/mcpToolError.js';

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

const MAX_COORD = 100000;

/** Refuse layouts that would write wrong or dropped zones; callers run this before any write. */
export function validateLayoutSpec(
  layoutSpec: Pick<
    LayoutSpec,
    'kpis' | 'charts' | 'layoutType' | 'gridColumns' | 'kpiStripHeight' | 'customZones'
  >,
  titleText?: string,
): ArgsValidationError | undefined {
  const { kpis, charts, layoutType, gridColumns, kpiStripHeight, customZones } = layoutSpec;
  const names = [...kpis, ...charts];
  const duplicated = [...new Set(names.filter((name, i) => names.indexOf(name) !== i))];
  if (duplicated.length > 0) {
    return new ArgsValidationError(
      `Worksheet(s) listed more than once in kpis and charts: ${quoteList(duplicated)}. Each sheet gets one zone.`,
    );
  }
  if (
    layoutType === 'auto-grid' &&
    gridColumns !== undefined &&
    !(Number.isInteger(gridColumns) && gridColumns >= 1 && gridColumns <= 6)
  ) {
    return new ArgsValidationError(
      `layout gridColumns must be an integer from 1 to 6; received ${gridColumns}.`,
    );
  }
  if (
    layoutType !== 'executive-summary' &&
    kpiStripHeight !== undefined &&
    !(kpiStripHeight >= 0 && kpiStripHeight <= 100)
  ) {
    return new ArgsValidationError(
      `layout kpiStripHeight is a percent from 0 to 100; received ${kpiStripHeight}.`,
    );
  }
  if (
    layoutType !== 'executive-summary' &&
    kpis.length > 0 &&
    kpiStripHeight !== undefined &&
    Math.floor(MAX_COORD * (kpiStripHeight / 100)) < 1
  ) {
    return new ArgsValidationError(
      `layout kpiStripHeight must be above 0 when kpis are given; received ${kpiStripHeight}.`,
    );
  }
  if (layoutType === 'custom' && charts.length > 0) {
    if (!customZones) {
      return new ArgsValidationError(
        'layoutType "custom" requires customZones with one zone per chart; none were provided.',
      );
    }
    for (const cz of customZones) {
      const x = Math.round(cz.x);
      const y = Math.round(cz.y);
      const w = Math.round(cz.width);
      const h = Math.round(cz.height);
      if (
        [x, y, w, h].some((v) => !Number.isFinite(v) || v < 0 || v > MAX_COORD) ||
        x + w > MAX_COORD ||
        y + h > MAX_COORD ||
        w < 1 ||
        h < 1
      ) {
        return new ArgsValidationError(
          `Custom zone "${cz.worksheetName}" must keep x and y within 0..${MAX_COORD}, width and height at least 1 after rounding, and x+width and y+height at most ${MAX_COORD}; received x=${cz.x}, y=${cz.y}, width=${cz.width}, height=${cz.height}.`,
        );
      }
    }
    const zonedNames = customZones.map((cz) => cz.worksheetName);
    const repeated = [...new Set(zonedNames.filter((n, i) => zonedNames.indexOf(n) !== i))];
    if (repeated.length > 0) {
      return new ArgsValidationError(
        `customZones name worksheet(s) more than once: ${quoteList(repeated)}. Each chart gets one zone.`,
      );
    }
    const kpiZoned = zonedNames.filter((name) => kpis.includes(name));
    if (kpiZoned.length > 0) {
      return new ArgsValidationError(
        kpiZoned
          .map(
            (name) =>
              `"${name}" is a KPI; KPIs always go in the KPI strip, so drop its customZone.`,
          )
          .join(' '),
      );
    }
    const missing = charts.filter((chart) => !zonedNames.includes(chart));
    if (missing.length > 0) {
      return new ArgsValidationError(
        `layoutType "custom" has no customZone for chart(s): ${quoteList(missing)}. Give every chart a zone.`,
      );
    }
    const unknown = zonedNames.filter((name) => !charts.includes(name));
    if (unknown.length > 0) {
      return new ArgsValidationError(
        `customZones name worksheet(s) that are not in charts: ${quoteList(unknown)}.`,
      );
    }
  }
  const doesNotFit = (zone: Zone): boolean =>
    zone.w < 1 || zone.h < 1 || zone.x + zone.w > MAX_COORD || zone.y + zone.h > MAX_COORD;
  const outOfCanvas = computeZones(titleText, layoutSpec as LayoutSpec).find(doesNotFit);
  if (outOfCanvas) {
    const label = outOfCanvas.kind === 'worksheet' ? `"${outOfCanvas.name}"` : 'the title';
    const detail = `the zone for ${label} would be x=${outOfCanvas.x}, y=${outOfCanvas.y}, width=${outOfCanvas.w}, height=${outOfCanvas.h} on a ${MAX_COORD} canvas`;
    if (charts.length === 0) {
      return new ArgsValidationError(
        `The title and KPI strip do not fit on the canvas: ${detail}. Drop the title or use fewer KPIs.`,
      );
    }
    const slimStripFits =
      layoutType !== 'executive-summary' &&
      kpis.length > 0 &&
      !computeZones(titleText, { ...(layoutSpec as LayoutSpec), kpiStripHeight: 1 }).some(
        doesNotFit,
      );
    return new ArgsValidationError(
      `The title and KPI strip leave no room for the charts: ${detail}. ${
        slimStripFits ? 'Lower kpiStripHeight' : 'Drop the title or use fewer sheets'
      }.`,
    );
  }
  return undefined;
}

function quoteList(items: string[]): string {
  return items.map((item) => `"${item}"`).join(', ');
}

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

export function buildDashboardXml(
  dashboardName: string,
  zones: Zone[],
  layoutType?: LayoutSpec['layoutType'],
): string {
  const rootId = zones.some((zone) => zone.id === 9)
    ? Math.max(9, ...zones.map((zone) => zone.id)) + 1
    : 9;
  let nextId = Math.max(rootId, ...zones.map((zone) => zone.id)) + 1;
  const overlaps = zones.some((zone, index) =>
    zones
      .slice(index + 1)
      .some(
        (other) =>
          zone.x < other.x + other.w &&
          other.x < zone.x + zone.w &&
          zone.y < other.y + other.h &&
          other.y < zone.y + zone.h,
      ),
  );
  const rows: Zone[][] = [];
  for (const zone of zones) {
    const row = rows.find((group) => group[0].y === zone.y && group[0].h === zone.h);
    if (row) row.push(zone);
    else rows.push([zone]);
  }
  rows.sort((a, b) => a[0].y - b[0].y);
  const tilesCanvas =
    !overlaps &&
    rows.every((row, index) => {
      const ordered = [...row].sort((a, b) => a.x - b.x);
      return (
        row[0].y === (index === 0 ? 0 : rows[index - 1][0].y + rows[index - 1][0].h) &&
        ordered[0].x === 0 &&
        ordered.every(
          (zone, column) =>
            column === 0 || Math.abs(zone.x - (ordered[column - 1].x + ordered[column - 1].w)) <= 1,
        ) &&
        Math.abs(ordered.at(-1)!.x + ordered.at(-1)!.w - 100000) <= row.length
      );
    }) &&
    (rows.length === 0 || Math.abs(rows.at(-1)![0].y + rows.at(-1)![0].h - 100000) <= rows.length);
  const bandsXml = rows
    .map((row) => {
      if (row.length === 1) return buildZoneXml(row[0]);
      const x = Math.min(...row.map((zone) => zone.x));
      const w = Math.max(...row.map((zone) => zone.x + zone.w)) - x;
      return `<zone h="${row[0].h}" id="${nextId++}" param="horz" type-v2="layout-flow" w="${w}" x="${x}" y="${row[0].y}">
          ${row.map(buildZoneXml).join('\n          ')}
        </zone>`;
    })
    .join('\n        ');
  const zonesXml =
    layoutType === 'custom' || (layoutType === undefined && !tilesCanvas)
      ? zones.map(buildZoneXml).join('\n        ')
      : `<zone h="100000" id="${nextId++}" param="vert" type-v2="layout-flow" w="100000" x="0" y="0">
        ${bandsXml}
      </zone>`;
  return `<dashboard enable-sort-zone-taborder="true" name="${escapeXml(dashboardName)}">
  <style/>
  <size maxheight="1000" maxwidth="1400" minheight="1000" minwidth="1400" sizing-mode="fixed"/>
  <zones>
    <zone h="100000" id="${rootId}" type-v2="layout-basic" w="100000" x="0" y="0">
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
            h: Math.round(cz.height),
            id: nextId++,
            name: cz.worksheetName,
            w: Math.round(cz.width),
            x: Math.round(cz.x),
            y: Math.round(cz.y),
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
