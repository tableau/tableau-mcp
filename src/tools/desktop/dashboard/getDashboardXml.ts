import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { writeFileSync } from 'fs';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { formatArtifactSummary } from '../../../desktop/artifactSummary.js';
import { DesktopCache } from '../../../desktop/cache.js';
import { getDashboardXml } from '../../../desktop/commands/workbook/getDashboardXml.js';
import {
  buildInlineCapFileMessage,
  isOverInlineXmlCap,
  logInlineXmlCapHit,
  xmlByteLength,
} from '../../../desktop/inlineXmlCap.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import {
  DesktopCommandExecutionError,
  GetDashboardXmlFailedError,
  UnknownError,
} from '../../../errors/mcpToolError.js';
import { log } from '../../../logging/logger.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  dashboardName: z.string().describe('Existing dashboard name.'),
  mode: z
    .enum(['file', 'inline'])
    .optional()
    .default('file')
    .describe('file writes cache path; inline returns XML.'),
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
      'Get XML for an existing dashboard. mode=file is default; mode=inline returns XML.',
      'IMPORTANT: only works for an existing dashboard (see list-dashboards); to create one use apply-workbook. Use apply-dashboard to apply changes.',
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
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const resolvedSession = sessionResult.value;
          const executor = await extra.getExecutor(resolvedSession);
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
          const bytes = xmlByteLength(dashboardXml);
          const capBytes = extra.config.inlineXmlMaxBytes;
          const capFired = mode === 'inline' && isOverInlineXmlCap(bytes, capBytes);

          if (mode === 'inline' && !capFired) {
            return new Ok({
              message: `Dashboard XML returned inline (${bytes} bytes)`,
              dashboardXml,
            });
          }

          const safeName = dashboardName.replace(/[^a-zA-Z0-9]/g, '_');
          const cacheFile = new DesktopCache().getCacheFilePath({
            prefix: `dashboard-${safeName}`,
          });
          writeFileSync(cacheFile, dashboardXml, 'utf-8');

          if (capFired) {
            logInlineXmlCapHit({ tool: 'get-dashboard-xml', bytes, capBytes, file: cacheFile });
            return Ok({
              message: buildInlineCapFileMessage({
                kind: 'dashboard',
                label: `Dashboard "${dashboardName}"`,
                bytes,
                capBytes,
                xml: dashboardXml,
              }),
              file: cacheFile,
              instructions:
                'This dashboard exceeds the inline cap. Use read-cached-xml (with a dashboard ' +
                'selector or startByte/endByte to read a slice), write-cached-xml (same selector to ' +
                'splice edits back), then apply-dashboard with mode=file. Do not request mode=inline.',
            });
          }

          log({
            message: `Saved dashboard XML to cache file: ${cacheFile}`,
            level: 'info',
            logger: 'tool',
            data: { file: cacheFile, size: bytes },
          });

          return Ok({
            message: `Dashboard "${dashboardName}" saved to cache file (${bytes} bytes)\n\nArtifact summary:\n${formatArtifactSummary('dashboard', dashboardXml)}`,
            file: cacheFile,
            instructions:
              'Use this file path with apply-dashboard instead of passing XML directly.',
          });
        },
      });
    },
  });

  return getDashboardXmlTool;
};
