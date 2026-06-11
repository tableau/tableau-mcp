import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { writeFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { DesktopCache } from '../../../desktop/cache.js';
import { getDashboardXml } from '../../../desktop/commands/workbook/getDashboardXml.js';
import {
  DesktopCommandExecutionError,
  GetDashboardXmlFailedError,
  UnknownError,
} from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().describe('Tableau instance Session ID from list-instances.'),
  dashboardName: z.string().describe('Name of the dashboard to get (must exist in the workbook).'),
  mode: z
    .enum(['file', 'inline'])
    .optional()
    .default('file')
    .describe(
      'file: write cache and return path (default). inline: return dashboard XML in the tool result.',
    ),
};

type InlineResult = { dashboardXml: string };
type FileResult = { file: string; instructions: string };
type GetDashboardXmlToolResult = { message: string } & (InlineResult | FileResult);

const title = 'Get Dashboard XML';
export const getGetDashboardXmlTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const getDashboardXmlTool = new DesktopTool({
    server,
    name: 'get-dashboard-xml',
    title,
    description: [
      'Gets the XML for a specific dashboard.',
      'Default mode writes a cache file and returns the path (recommended).',
      'Use mode=inline to return XML in the response.',
      'IMPORTANT: This only works for existing dashboards — use list-dashboards to see available dashboards.',
      'To create new dashboards, use apply-workbook.',
      'Use apply-dashboard to apply changes.',
    ].join(' '),
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: false, // Writes to a cache file
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: false,
    },
    callback: async ({ session, dashboardName, mode }, extra): Promise<CallToolResult> => {
      return await getDashboardXmlTool.logAndExecute<GetDashboardXmlToolResult>({
        extra,
        args: { session, dashboardName, mode },
        callback: async () => {
          const executor = await extra.getExecutor(session);
          const result = await getDashboardXml({ dashboardName, executor, signal: extra.signal });

          if (result.isErr()) {
            const { type, error } = result.error;
            switch (type) {
              case 'get-dashboard-xml-error':
                return new GetDashboardXmlFailedError(error).toErr();
              case 'execute-command-error':
                return new DesktopCommandExecutionError(error).toErr();
              default: {
                const _: never = type;
                return new UnknownError(String(error)).toErr();
              }
            }
          }

          const dashboardXml = result.value;
          const bytes = new TextEncoder().encode(dashboardXml).byteLength;

          switch (mode) {
            case 'inline': {
              return new Ok({
                message: `Dashboard XML returned inline (${bytes} bytes)`,
                dashboardXml,
              });
            }
            case 'file': {
              const safeName = dashboardName.replace(/[^a-zA-Z0-9]/g, '_');
              const cacheFile = new DesktopCache().getCacheFilePath({
                prefix: `dashboard-${safeName}`,
              });
              writeFileSync(cacheFile, dashboardXml, 'utf-8');
              log({
                message: `Saved dashboard XML to cache file: ${cacheFile}`,
                level: 'info',
                logger: 'tool',
                data: { file: cacheFile, size: bytes },
              });

              return Ok({
                message: `Dashboard "${dashboardName}" saved to cache file (${bytes} bytes)`,
                file: cacheFile,
                instructions:
                  'Use this file path with apply-dashboard instead of passing XML directly.',
              });
            }
          }
        },
      });
    },
  });

  return getDashboardXmlTool;
};
