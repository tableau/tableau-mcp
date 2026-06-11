import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getWorkbookXml } from '../../../desktop/commands/workbook/getWorkbookXml.js';
import { injectViewpoints } from '../../../desktop/commands/workbook/injectViewpoints.js';
import { loadDashboardXml } from '../../../desktop/commands/workbook/loadDashboardXml.js';
import { loadWorkbookXml } from '../../../desktop/commands/workbook/loadWorkbookXml.js';
import {
  DashboardXmlLoadFailedError,
  DesktopCommandExecutionError,
  WorkbookNotFoundError,
  WorkbookXmlLoadFailedError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const customZoneSchema = z.object({
  worksheetName: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

const layoutSpecSchema = z.object({
  kpis: z.array(z.string()).describe('Worksheet names for KPI strip'),
  charts: z.array(z.string()).describe('Worksheet names for chart grid'),
  layoutType: z.enum(['auto-grid', 'rows', 'columns', 'custom']).optional().default('auto-grid'),
  gridColumns: z.number().optional().describe('Number of columns for auto-grid layout'),
  kpiStripHeight: z
    .number()
    .optional()
    .describe('KPI strip height as a percentage of total height (0-100)'),
  customZones: z.array(customZoneSchema).optional(),
});

const paramsSchema = {
  session: z.string().describe('Tableau instance Session ID from list-instances.'),
  dashboardName: z.string().describe('Name of the dashboard to build and apply.'),
  dashboardFile: z
    .string()
    .describe('Path to the cached empty dashboard XML (obtained from get-dashboard-xml).'),
  workbookFile: z
    .string()
    .describe('Path to the cached workbook XML (obtained from get-workbook-xml).'),
  title: z
    .string()
    .optional()
    .describe('Optional title text to display at the top of the dashboard.'),
  layoutSpec: layoutSpecSchema.describe('Layout specification for KPI strip and chart grid.'),
  worksheetNames: z
    .array(z.string())
    .describe('All worksheet names to register as viewpoints in the dashboard window.'),
};

const ZONE_STYLE = `<zone-style>
            <format attr="border-color" value="#000000"/>
            <format attr="border-style" value="none"/>
            <format attr="border-width" value="0"/>
            <format attr="margin" value="4"/>
          </zone-style>`;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

type Zone =
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

function buildZoneXml(zone: Zone): string {
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

function buildDashboardXml(dashboardName: string, zones: Zone[]): string {
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

const title = 'Build and Apply Dashboard';
export const getBuildAndApplyDashboardTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'build-and-apply-dashboard',
    title,
    description: [
      'Build dashboard layout XML from a layout spec and immediately apply it to Tableau.',
      'Constructs zones for a KPI strip and chart grid, registers viewpoints, then applies both the workbook and dashboard in one call.',
      'Designed for parallel execution alongside worksheet builders.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    callback: async (
      {
        session,
        dashboardName,
        dashboardFile,
        workbookFile,
        title: titleText,
        layoutSpec,
        worksheetNames,
      },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { session, dashboardName, dashboardFile, workbookFile, layoutSpec, worksheetNames },
        callback: async () => {
          if (!existsSync(workbookFile)) {
            return new WorkbookNotFoundError(
              `Workbook cache file not found: ${workbookFile}`,
            ).toErr();
          }

          if (!existsSync(dashboardFile)) {
            return new WorkbookNotFoundError(
              `Dashboard cache file not found: ${dashboardFile}`,
            ).toErr();
          }

          // Build zones
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

          const dashboardXml = buildDashboardXml(dashboardName, zones);
          const executor = await extra.getExecutor(session);

          // Fetch workbook, inject viewpoints, apply workbook
          const workbookResult = await getWorkbookXml({ executor, signal: extra.signal });
          if (workbookResult.isErr()) {
            return new DesktopCommandExecutionError(workbookResult.error).toErr();
          }

          const updatedWorkbookXml = injectViewpoints(
            workbookResult.value,
            dashboardName,
            worksheetNames,
          );

          const workbookApplyResult = await loadWorkbookXml({
            xml: updatedWorkbookXml,
            executor,
            signal: extra.signal,
          });

          if (workbookApplyResult.isErr()) {
            const { type, error } = workbookApplyResult.error;
            switch (type) {
              case 'execute-command-error':
                return new DesktopCommandExecutionError(error).toErr();
              case 'load-workbook-xml-error':
                return new WorkbookXmlLoadFailedError(error).toErr();
              default: {
                const _: never = type;
              }
            }
          }

          // Apply dashboard
          const dashboardApplyResult = await loadDashboardXml({
            dashboardName,
            xml: dashboardXml,
            executor,
            signal: extra.signal,
          });

          if (dashboardApplyResult.isErr()) {
            const { type, error } = dashboardApplyResult.error;
            switch (type) {
              case 'execute-command-error':
                return new DesktopCommandExecutionError(error).toErr();
              case 'load-dashboard-xml-error':
                return new DashboardXmlLoadFailedError(error).toErr();
              default: {
                const _: never = type;
              }
            }
          }

          return new Ok({
            message: `Successfully built and applied dashboard "${dashboardName}".`,
            dashboardName,
            kpiCount: layoutSpec.kpis.length,
            chartCount: layoutSpec.charts.length,
            viewpointCount: worksheetNames.length,
          });
        },
      });
    },
  });

  return tool;
};
