import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { loadDashboardXml } from '../../../desktop/commands/workbook/loadDashboardXml.js';
import {
  buildApplyOverCapNote,
  isOverInlineXmlCap,
  xmlByteLength,
} from '../../../desktop/inlineXmlCap.js';
import {
  ArgsValidationError,
  DashboardXmlLoadFailedError,
  DesktopCommandExecutionError,
  FileReadError,
  WorkbookNotFoundError,
} from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().describe('Session ID from list-instances.'),
  dashboardName: z.string().describe('Name of the dashboard to update (must already exist).'),
  mode: z
    .enum(['file', 'inline'])
    .optional()
    .default('file')
    .describe('file reads dashboardFile; inline uses dashboardXml.'),
  dashboardFile: z.string().optional().describe('Modified dashboard cache file for mode=file.'),
  dashboardXml: z.string().optional().describe('Dashboard XML for mode=inline.'),
};

const title = 'Apply Dashboard';
export const getApplyDashboardTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const applyDashboardTool = new DesktopTool({
    server,
    name: 'apply-dashboard',
    title,
    description: [
      'Apply modified dashboard XML to Tableau (mutating). mode=file is default; mode=inline is for small XML.',
      'IMPORTANT: can only UPDATE an existing dashboard, not create one — use apply-workbook to create.',
      'See expertise://tableau/tableau-tactics/dashboard/zones for zone structure.',
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
      { session, dashboardName, mode, dashboardFile, dashboardXml },
      extra,
    ): Promise<CallToolResult> => {
      return await applyDashboardTool.logAndExecute({
        extra,
        args: { session, dashboardName, mode, dashboardFile, dashboardXml },
        callback: async () => {
          switch (mode) {
            case 'inline': {
              if (!dashboardXml?.trim()) {
                return new ArgsValidationError(
                  'When mode=inline, a non-empty dashboard XML string is required.',
                ).toErr();
              }
              break;
            }
            case 'file': {
              if (!dashboardFile?.trim()) {
                return new ArgsValidationError(
                  [
                    'When mode=file, a non-empty dashboard file path is required.',
                    'The path can be determined using get-dashboard-xml.',
                  ].join(' '),
                ).toErr();
              }

              if (!existsSync(dashboardFile)) {
                return new WorkbookNotFoundError(
                  [
                    `Cached dashboard file not found: ${dashboardFile}`,
                    'Provide a path determined by get-dashboard-xml.',
                  ].join(' '),
                ).toErr();
              }

              try {
                dashboardXml = readFileSync(dashboardFile, 'utf-8');
              } catch (error) {
                return new FileReadError(error).toErr();
              }
              break;
            }
          }

          const executor = await extra.getExecutor(session);
          const result = await loadDashboardXml({
            dashboardName,
            xml: dashboardXml,
            executor,
            signal: extra.signal,
          });

          if (result.isErr()) {
            const { type, error } = result.error;
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

          const capBytes = extra.config.inlineXmlMaxBytes;
          const inlineBytes = mode === 'inline' ? xmlByteLength(dashboardXml ?? '') : 0;
          const note =
            mode === 'inline' && isOverInlineXmlCap(inlineBytes, capBytes)
              ? `\n\n${buildApplyOverCapNote(inlineBytes, capBytes)}`
              : '';

          return new Ok({
            message: `Successfully applied dashboard XML for "${dashboardName}". The dashboard has been updated.${note}`,
          });
        },
      });
    },
  });

  return applyDashboardTool;
};
